/**
 * BATTLEFRONT BORZ — front end.
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
import { ROBE_CUTS, attachCloak, attachSkirt, attachLekku,
         CAPE_CUTS, TABARD_CUTS, SASH_CUTS, GARMENT_TONES, WARDROBE, wardrobeOf, tintWardrobe,
         garmentTone } from '../game/Cloth.js';
import { applyInjury } from '../game/Injury.js';
import { LEVELS, LEVEL_ORDER } from '../game/Levels.js';
// The Descent's ladder, named on the Deploy panel because the mode picks its
// own places and the Theatre column has no say in it — see _syncTheatre.
import { DIFFICULTY } from '../game/Combat.js';
// The Codex and the training panel both quote Focus's numbers. They are read
// from the system rather than typed, because both of them had been left behind
// by the round that changed heldScale from 0.35 to 0.18.
import { FOCUS } from '../game/Focus.js';
// How many lessons there are, counted rather than typed: the training panel
// offers to start them and the number in that sentence is the length of the
// list it starts. MODES.training's own blurb says "the eleven lessons" and it
// is the same eleven.
import { LESSONS } from '../game/Dojo.js';
import { MODES, sandboxUnits, SANDBOX_MAX_ENEMIES, sandboxConfig,
         DRAFT_EVERY, BOSS_EVERY } from '../game/Waves.js';
import { audio, MUSIC_TRACKS, trackAt, SPOKEN_LINES, wordsFor, canSpeakWords } from '../engine/Audio.js';
import { voiceAt, PLAYER_VOICES } from '../engine/Voice.js';
// The reticle's shape table and its painter live with the HUD that draws it;
// the options screen borrows both rather than keeping a second copy that could
// fall out of step with what is actually on screen.
import { applyReticle, shapeAt, colorAt, RETICLE_SHAPES, RETICLE_COLORS, EMOTES,
         rosterHtml } from './HUD.js';
import { QUALITY } from '../engine/Engine.js';
import { ACTIONS, MOUSE, WHEEL, keyLabel, loadBindings, saveBindings, defaultBindings, resolveConflicts,
         WALK_SCALE, walkScale, registerOrders, ORDER_ACTIONS } from '../engine/Bindings.js';
// The six formation orders, so they can be pushed through Bindings' seam below.
import { FORMATIONS, TEAM_DAMAGE_DEFAULT, DEFAULT_FORMATION } from '../game/Command.js';

/**
 * THE SIX ORDER KEYS JOIN THE TABLE, HERE, AND IT HAS TO BE HERE.
 *
 * `FORMATIONS` is `game/`; `ACTIONS` is `engine/`. Neither may import the
 * other — an engine module reaching up into game is the cross-layer edge this
 * project has already paid for once as a boot-time TDZ crash. This file is
 * `ui/`, it already imports eight game modules and the bindings table, and it
 * is the screen where a control is rebound; it is the one place allowed to see
 * both sides, so it is where they are introduced.
 *
 * At MODULE SCOPE, and above `CODEX`, on purpose. Everything downstream reads
 * the table as a plain list — `defaultBindings`, `loadBindings`, the options
 * list, `findConflicts`, `conflicts`, the Codex block generated below — and
 * every one of them would see six fewer actions if this ran inside a
 * constructor. A binding table that is complete only after somebody opens a
 * menu is not a binding table.
 *
 * Nothing is typed twice: the id, the name, the default key and the blurb all
 * come off the formation record. tools/checks/controls.mjs re-derives the same
 * set straight from FORMATIONS and fails on any row that disagrees.
 *
 * Measured before it was written, because the graph is the whole risk: this
 * edge was added and every module in the tree imported as a FIRST entry point
 * in its own process — Player.js, Menu.js, Command.js, Enemy.js, HUD.js,
 * World.js, Waves.js, Bodies.js. All eight evaluate clean, and FORMATIONS is
 * fully initialised by the time this line runs from every one of them. Command
 * imports Enemy, Bodies, Combat, Bolts, Waves and MathUtil, and none of those
 * reaches back into ui/, so there is no cycle to close.
 */
registerOrders(FORMATIONS);

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
/**
 * What the death card says when the caller does not say otherwise.
 *
 * Here rather than in index.html's markup, because the markup is a SEED — it
 * is written once at parse time and never restored, and the one path that
 * overwrites it (the Descent's crown) then owned the element for the rest of
 * the session. A default that lives next to the only writer cannot go stale.
 */
export const DEATH_TITLE = 'You are one with the Force';

/**
 * …and the other ending. `showDeath` has taken a title since it was written and
 * nothing ever passed one, so finishing the campaign printed the death line over
 * a victory. The advance is the only thing in this game that can be WON.
 */
export const VICTORY_TITLE = 'The advance is yours';

export const BLADE_CAP = 1.45;
export const BLADE_MAX = 4.0;

/**
 * How much of a pinned column the "there is more below" fade covers, in px.
 *
 * The fade itself is a mask in styles.css (`.col.narrow.pinned.more`); this is
 * the same number, quoted here because `_revealMode` has to keep the card it
 * reveals CLEAR of it, and a reveal that lands under the fade is a reveal that
 * did not happen. tools/checks/front-screen.mjs reads the stylesheet and asserts
 * the two agree, so the copy cannot drift.
 */
export const SCROLL_FADE = 26;

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
  level: 'scoria',
  /**
   * WHO YOU ARE ON SOMEBODY ELSE'S SCREEN.
   *
   * Empty by default and falls back to 'Jedi' at the seam that uses it, so a
   * solo player sees exactly what they always saw and a co-op session stops
   * being four rows of the same word. See _buildButtons for the field and
   * main.js for the one place the fallback is applied.
   */
  playerName: '',
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
  /**
   * THE REST OF THE CLOTHES, and it is ONE object for the reason `face` is.
   *
   * The report: "you can only change the lower robe, like you can't change all
   * the clothes. I want to be able to change all the clothes and also be able
   * to choose from different capes or even go capeless." Exactly right —
   * `robeCut` above cuts the SKIRT and `robeIndex` picks one palette for the
   * whole figure, and every other layer on the body was the same on every
   * character in the game.
   *
   * Nine keys rather than nine settings, because they are one choice made on
   * one screen, and because nine top-level keys would each want a line in this
   * blob, a reader declaration, and a row in three checks. `face` made the same
   * trade for the same reason and the note over it is the precedent.
   *
   * The shape, the defaults and the normaliser all live in game/Cloth.js
   * (WARDROBE / wardrobeOf), beside the garments they describe — this file
   * stores the answer and does not own the vocabulary. `wardrobeOf` is applied
   * on load exactly as `characterSheet` is, so a blob written by an older build
   * or a corrupt one cannot leave a character with no cape at all.
   */
  wardrobe: { ...WARDROBE },
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
  // These bite in Sandbox mode and in Training, and nowhere else: they are
  // practice controls, not difficulty controls. (It said "in the dojo" until
  // the panel that quotes it was audited — the dojo level was deleted with no
  // alias, and three separate strings were still sending players there.) Zero
  // is legal for both numbers — an empty arena and a room of droids that never
  // fire are both things a player asked for and could not have.
  sandboxCount: 5,
  sandboxFire: 1,
  sandboxType: 'mixed',
  unlimitedBlade: false,
  // The other half of note 46. The slow-motion itself was deepened (heldScale
  // 0.35 -> 0.18, see FOCUS); this is the option that lets a player who is
  // still learning to read a volley hold it without paying for it.
  unlimitedFocus: false,
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
  /**
   * HOW MUCH OF THE HOLOCRON IS ALREADY OPEN when a run begins.
   *
   * 'earned' is the game: Insight is a run currency, you kneel to spend it,
   * and nothing carries over. That is load-bearing design and it stays the
   * default.
   *
   * The other two exist because of a real report — "I can't actually test out
   * anything in the Holocron to even know if it works… I haven't even been
   * able to force lightning or force compel yet." Both of those powers are
   * gated behind `boonMods.lightning` / `boonMods.compel`, which arrive only
   * as a boon, which arrives only from a draft or a facet you paid Insight
   * for, at roughly 1.4 Insight a wave. A player can finish a run without
   * ever seeing half the kit, and a kit nobody can reach is a kit nobody can
   * tell you is broken.
   *
   *   'open'  a full purse at the start of every run. Everything is
   *           reachable and the SHAPE of the choice is intact — you still
   *           kneel, you still pick, prices still escalate.
   *   'all'   every facet already lit. No choice at all: this is the
   *           workshop setting, for looking at a power rather than earning it.
   */
  holocron: 'earned',
  /**
   * ── COMMAND: the two settings that had a reader and no control ──────
   *
   * `commandConfig` in game/Command.js reads both and is the only thing
   * allowed to interpret either, exactly as `sandboxConfig` and `pvpRules`
   * are for their own. Neither key was in this object, which is how both of
   * them escaped BOTH of controls.mjs's dead-control guards at once: those
   * guards iterate `Object.keys(DEFAULT_SETTINGS)`, so a setting that is read
   * but never defaulted is invisible to the check that exists to find settings
   * nothing can move. The guard is fixed in the same round as the settings —
   * it now scans src/ for what is actually READ, which is what found these.
   *
   * `teamDamage` is note #29's, asked for by name: "maybe there's a setting
   * for how much team damage you do." Its default is Command.js's own
   * constant, not a second copy of 0.35.
   */
  teamDamage: TEAM_DAMAGE_DEFAULT,
  /** The formation your army starts every area in. See FORMATIONS. */
  commandFormation: DEFAULT_FORMATION,
  /**
   * TWO SIDES COMMAND TWO DIFFERENT ARMIES AND MEET ON THE BATTLEFIELD.
   *
   * `commandConfig` reads it and nothing else may, exactly as for the two
   * above. Off by default because a meeting needs two people: it turns Command
   * from a campaign against a composed horde into one battle against another
   * player's roster, on two anchors 120 m apart, decided by whose army is left
   * standing (World.beginVersus).
   *
   * Declared here even though no control writes it yet, and that is the whole
   * point of the guard this key was caught by: a setting that is READ by
   * shipped code and never DECLARED is invisible to both of the dead-control
   * checks, because they iterate the keys of this object. Being in it is what
   * makes "this has no control" a question anybody can ask.
   */
  commandVersus: false,
  quality: 'high',
  resolutionScale: 1,
  /**
   * WHETHER REINFORCEMENTS FLY IN, OR SIMPLY APPEAR.
   *
   * `Waves.instantSpawn(settings)` is the single reader — a gunship on final
   * approach, a door, a drop pod, all of Arrivals.js — and it had no default
   * and no box, so the fast path existed and no player could reach it. Off is
   * the game; on is what a machine that cannot afford the craft wants, and
   * what anybody testing a wave wants.
   */
  instantSpawn: false,
  /**
   * HOW MUCH WRECKAGE THE PHYSICS WORLD WILL HOLD AT ONCE.
   *
   * Read by World's RapierWorld constructor, which culled the oldest debris
   * past this many bodies and had no setting behind it — `settings.maxBodies
   * ?? 1100`, where nothing anywhere wrote `maxBodies`. Severed limbs, cut
   * props and shattered walls all land in that budget, so it is the one number
   * that decides whether a long fight leaves a battlefield or a clean floor.
   */
  maxBodies: 1100,
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
  /**
   * WORDS, OR THE WORDLESS VOICE, OR BOTH.
   *
   * "I want to be able to say actual voice lines. Like the alien robotic
   * speech is cool and all but we should be able to do actual voicelines."
   * The synthesiser stays — it is five larynxes built from an oscillator, two
   * formant filters and a breath of noise, and the player says it is the cool
   * part — and 'spoken' says the same line through the browser's own
   * `speechSynthesis`, which is real words at zero bytes on a project whose
   * whole claim is that there is nothing to download.
   *
   * 'synth' is the default because it is the game as it stands, and because a
   * feature that changes how everyone's game sounds without being asked is not
   * an option, it is a patch. Read live by engine/Audio.js.
   */
  speechMode: 'synth',
  /**
   * WHICH SCORE, as an index into MUSIC_TRACKS (engine/Audio.js).
   *
   * "I want to have different options for the soundtrack… like selecting one
   * or the other?" An index rather than an id for the reason `voiceIndex` is
   * one: it rides a slider, which is the only control this screen has that can
   * carry a NAME and still be one input, and the table is the authority for
   * how many there are.
   */
  musicIndex: 0,
  voiceLevel: 0.9,
  voiceLines: true,
  enemyVoices: true,
  enemyBody: true,
  /** Killstreak and event popups in the HUD's score column. */
  popups: true,
  /**
   * THE MINIMAP, on by default and switchable off.
   *
   * On because a fight against 25 bodies with no idea where the other 24 are is
   * the thing the player asked to stop having; off because a map is also the
   * single biggest thing you can take off the screen to make the game look like
   * a film, and this build has a free camera in it now. Read live off this blob
   * by HUD.Minimap, so unticking it takes the disc down on the next frame and
   * stops it costing anything at all — see MINIMAP for the budget.
   */
  minimap: true,
  /**
   * …AND WHETHER IT COSTS ANYTHING TO LOOK AT IT.
   *
   * "Bringing up the minimap should maybe use some force like you're using
   * force sense you know what I mean?" On, so the map is a READING taken with
   * Force sense — the power that already costs to switch on, drains while it
   * is open and stops regeneration — and off, so it is the permanent window
   * that shipped.
   *
   * The two boxes are separate on purpose. `minimap` answers "do I want a map
   * at all" and this answers "am I willing to pay for it", and folding them
   * into one control would mean a player who cannot manage a Force power
   * mid-fight has to give up the map entirely to stop being charged for it.
   * That is the accessibility case, and it is the whole reason this is a
   * setting rather than a rule. Read live by HUD.Minimap, so it bites on the
   * next frame.
   */
  minimapSense: true,
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
  playerName:      ['main.js', 'settings.playerName'],
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
  /**
   * The rest of the clothes, read HERE rather than in World.spawnPlayer — and
   * that is a statement about ownership, not a workaround. `buildJedi` takes
   * one palette index and no garment list, and the cape, the over-panels and
   * the belt's ends are all attached AFTER a body is built, by
   * `attachCloak`/`attachSkirt`. `applyWardrobe` is the seam that does it, it
   * runs on every `applyFeelSettings`, and it is what makes a piece picked on
   * the pause card land on the body without a redeploy.
   */
  wardrobe:        ['ui/Menu.js', 'wardrobeOf(s.wardrobe)'],
  skinIndex:       ['game/World.js', 'skinIndex: this.settings.skinIndex'],
  hairIndex:       ['game/World.js', 'hairIndex: this.settings.hairIndex'],
  build:           ['game/World.js', 'build: this.settings.build'],
  bladeLength:     ['game/World.js', 'bladeLength: this.settings.bladeLength'],
  coreWidth:       ['game/World.js', 'coreWidth: this.settings.coreWidth'],
  sandboxCount:    ['game/Waves.js', 's.sandboxCount'],
  sandboxFire:     ['game/Waves.js', 's.sandboxFire'],
  sandboxType:     ['game/Waves.js', 's.sandboxType'],
  unlimitedBlade:  ['ui/Menu.js', 's.unlimitedBlade ? BLADE_MAX : BLADE_CAP'],
  unlimitedFocus:  ['game/World.js', 'this.settings.unlimitedFocus'],
  sensitivity:     ['game/World.js', 'sensitivity: this.settings.sensitivity'],
  camFollow:       ['game/World.js', 'followStrength: this.settings.camFollow'],
  fov:             ['main.js', 'settings.fov'],
  invertY:         ['main.js', 'input.invertY = settings.invertY'],
  firstPerson:     ['game/World.js', '!!this.settings.firstPerson'],
  scheme:          ['game/World.js', 'scheme: this.settings.scheme'],
  deflectAim:      ['game/World.js', 'this.settings.deflectAim'],
  forcePower:      ['game/Player.js', 'this.world.settings?.forcePower'],
  forceDrain:      ['game/Player.js', 'this.world.settings?.forceDrain'],
  holocron:        ['game/World.js', "settings.holocron"],
  /* Command's two, and `commandConfig` is the only thing allowed to read
   * either — the same shape as sandboxConfig and pvpRules, so a menu writes a
   * free-form number and exactly one function decides what it means. */
  teamDamage:      ['game/Command.js', 'const td = s.teamDamage'],
  commandFormation: ['game/Command.js', 'const f = s.commandFormation'],
  commandVersus:   ['game/Command.js', 'versus: !!s.commandVersus'],
  quality:         ['main.js', 'new Engine(canvas, settings.quality)'],
  resolutionScale: ['main.js', 'engine.setResolutionScale(settings.resolutionScale)'],
  /* One reader for arrivals, everywhere: the wave path, the sandbox path and
   * the dojo's spawner all ask `instantSpawn(settings)` rather than testing the
   * field, which is why there is one entry here and three call sites. */
  instantSpawn:    ['game/Waves.js', 'settings.instantSpawn'],
  maxBodies:       ['game/World.js', 'maxBodies: settings.maxBodies'],
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
  // Both of these are read inside the engine that acts on them rather than at
  // the control: `speechMode` decides whether a line is said in words at the
  // moment the announcer spends its budget, and `musicIndex` decides which
  // urls the score's element is handed when it is built.
  speechMode:      ['engine/Audio.js', "this.speechMode === 'synth'"],
  musicIndex:      ['engine/Audio.js', 'trackAt(this.musicIndex)'],
  voiceLevel:      ['ui/Announcer.js', 'Number.isFinite(settings.voiceLevel)'],
  voiceLines:      ['ui/Announcer.js', 'settings.voiceLines !== false'],
  enemyVoices:     ['ui/Announcer.js', 'settings.enemyVoices !== false'],
  enemyBody:       ['engine/Presence.js', 's.enemyBody !== false'],
  popups:          ['ui/HUD.js', 'world.settings.popups !== false'],
  minimap:         ['ui/HUD.js', 'settings.minimap !== false'],
  minimapSense:    ['ui/HUD.js', 'settings.minimapSense !== false'],
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
  applyWardrobe(world, s);
  applyGait(world);
  tapFrame(world);
  return !!(world._feelGated && (!rig || rig._feelGated));
}

/**
 * Throw a garment away, MATERIALS AND ALL.
 *
 * `Cloak.dispose` deliberately leaves a material it was HANDED alone, because
 * in the game the wearer owns it — and every material in a garment set here is
 * a per-figure CLONE that nothing else will ever free (Player clones the robe
 * palette for its cape and its skirt, attachSash clones again for the straps,
 * and the panels take a clone of the over-cloth). A wardrobe change that only
 * called dispose() would leak one clone per garment per change, which is a
 * texture-bearing material every time somebody tries a different cape on.
 * Collected by identity because the pair of sash straps share one.
 */
function disposeGarment(g) {
  if (!g) return 0;
  const mats = new Set();
  const walk = (c) => {
    if (!c || typeof c !== 'object') return;
    if (c.mat && c._sharedMat) mats.add(c.mat);
    for (const k of ['sash', 'tabard']) if (c[k]) walk(c[k]);
    for (const arr of ['parts', 'panels']) if (Array.isArray(c[arr])) c[arr].forEach(walk);
  };
  walk(g);
  g.dispose?.();
  for (const m of mats) m.dispose?.();
  return mats.size;
}

/**
 * DRESS EVERY LOCAL BODY IN WHAT THE PLAYER CHOSE, on the same seam.
 *
 * The wardrobe is nine choices and `Player._makeCloak` takes none of them: it
 * builds one cape at one size with one tabard under it, and src/game/Player.js
 * and src/game/Bodies.js both belong to other lanes this round. So the pieces
 * are put on from out here, exactly as the head-tails are — and for the same
 * three reasons, which are worth restating because they are what make this a
 * seam rather than a hack:
 *
 *   the garment has to be stepped on the GAME's clock, inside the frame the
 *   chest it hangs from was posed in, which `attachCloak`'s own contract with
 *   Player.update already guarantees for anything held in `p.cloak`;
 *
 *   it has to be disposed with the body, which is what `p.die()` already does
 *   to whatever is in those two fields;
 *
 *   and it has to survive a rebuild, which is what the signature below is for.
 *
 * WHAT IT REBUILDS AND WHAT IT DOES NOT. Colour is a material write and costs
 * nothing, so tones are pushed on every call. A cut is geometry, so the two
 * garments are torn down and rebuilt only when the choice actually changed —
 * `applyFeelSettings` runs on every checkbox tick on the pause card, and
 * rebuilding 287 particles of cloth because somebody turned film grain off
 * would be a stutter with no cause a player could see.
 *
 * THE NUMBERS THIS PASSES ARE NOT TYPED HERE. The cape's dimensions come from
 * CAPE_CUTS (whose `cloak` entry is Player._makeCloak's own five numbers, held
 * to them by tools/checks/preview.mjs), the skirt's from the robe cut, and the
 * materials from the palette the builder made. The one thing this states is
 * which pieces to build.
 *
 * Idempotent. Returns how many bodies were dressed.
 */
export function applyWardrobe(world, s = DEFAULT_SETTINGS) {
  if (!world || !world.scene) return 0;
  const w = wardrobeOf(s.wardrobe);
  const key = JSON.stringify([w.cape, w.tabard, w.sash, s.robeCut]);
  let n = 0;
  for (const p of world.players || []) {
    if (!p || p.isRemote || p.isLocal === false || !p.built || !p.rig || !p.palette) continue;
    /*
     * A BODY THAT HAS JUST BEEN BUILT IS ALREADY WEARING THE DEFAULT.
     *
     * `Player._makeCloak` builds the shipped cape, the shipped belt and the
     * chosen robe cut, so seeding the signature with those means a player who
     * has never opened these rows pays NOTHING here — no dispose, no rebuild,
     * no reallocation — and the figure in the world is the one the builder
     * made, particle for particle. Without the seed every deploy would tear
     * down 287 particles of cloth and build the same 287 again.
     */
    if (p._wardrobeKey === undefined) {
      p._wardrobeKey = JSON.stringify([WARDROBE.cape, WARDROBE.tabard, WARDROBE.sash, p.robeCut ?? s.robeCut]);
    }
    if (p._wardrobeKey !== key) {
      p._wardrobeKey = key;
      const S = p.rig.scale ?? 1;
      const cut = p.robeCut ?? s.robeCut;
      /*
       * The skirt first, because the cape collides against the skirt's own
       * particles and a cape built against a skirt that is about to be
       * replaced would spend its first frame hanging through the robe.
       */
      if (p.built.robeSkirt) {
        disposeGarment(p.skirt);
        const smat = (p.palette.over || p.palette.outer).clone();
        smat.side = THREE.DoubleSide;
        p.skirt = attachSkirt(world.scene, p.rig, {
          scale: S, material: smat, rigid: p.built.robeSkirt, cut,
          sashMaterial: p.palette.trim, sash: w.sash,
        });
      }
      disposeGarment(p.cloak);
      const cmat = p.palette.outer.clone();
      cmat.side = THREE.DoubleSide;
      const tmat = (p.palette.over || p.palette.outer).clone();
      tmat.side = THREE.DoubleSide;
      p.cloak = attachCloak(world.scene, p.rig, {
        scale: S, material: cmat, cut, cape: w.cape,
        tabard: w.tabard, tabardMaterial: tmat,
      });
      if (p.cloak) p.cloak.outer = p.skirt || null;
    }
    tintWardrobe(p.built, w, { skirt: p.skirt, cape: p.cloak });
    n++;
  }
  return n;
}

/**
 * THE SLOW WALK, on the same seam and for the same reason as everything above.
 *
 * The gait itself is four characters of arithmetic. What it needs is a place to
 * happen: `Player._move` computes `4.6 × boonMods.moveSpeed × (sprint ? 1.62 :
 * 1) × crouch` on one line, and src/game/Player.js belongs to another lane this
 * round. So the multiplier goes on the funnel the same way the shake, the
 * hitstop, the injury marks and the head-tails do — by wrapping the one method
 * the frame goes through, reading the binding LIVE off the context that method
 * is handed, and putting the number back afterwards.
 *
 * `boonMods.moveSpeed` is the multiplier `_move` reads, and it is the ONLY
 * thing in this file's reach that lands on the player's pace without touching
 * a line of Player. It is read exactly once per update — the line that begins
 * `const base = 4.6 * this.boonMods.moveSpeed` — and nothing else in the whole
 * tree reads it during a frame, because the three boons that write it
 * (Waves.js) do so at draft time. Borrowing it for the length of one call is
 * therefore exact rather than approximate.
 *
 * THE HANDOVER. When Player.js is free, this whole function should be deleted
 * and the line after that one, which today reads
 *
 *     let speed = base * (sprinting ? 1.62 : 1) * lerp(1, 0.48, this.crouch);
 *
 * should read
 *
 *     let speed = base * walkScale(input) * (sprinting ? 1.62 : 1) * lerp(1, 0.48, this.crouch);
 *
 * with `walkScale` imported from ../engine/Bindings.js. That is the same
 * arithmetic in the place that owns it, and it is one line. Until then this is
 * the same arithmetic in the only place that can reach it, and the check that
 * measures the four gaits does not care which of the two is producing them —
 * which is the property that makes the handover safe to take. (Expressions and
 * not line numbers, on purpose: five files in this tree are being edited in
 * parallel and a quoted line number is stale before it is read.)
 *
 * LOCAL BODIES ONLY, and `isRemote` is tested as well as `isLocal` because the
 * two are not each other's negation: `world.players` carries RemoteAvatars
 * (Net.js), which set `isRemote` and never set `isLocal` at all, and which ship
 * a deliberately EMPTY `boonMods` — so multiplying a key of it would write NaN
 * onto a pace that arrives from another machine already walked.
 *
 * Idempotent. Returns the number of bodies now walking on demand.
 */
export function applyGait(world) {
  /**
   * THE HANDOVER WAS TAKEN, so this no longer wraps anything.
   *
   * `Player._move` multiplies `walkScale(input)` into its own speed now, which
   * is the same arithmetic in the file that owns the pace. This wrapper was
   * the version that could be written from the UI side while five files were
   * being edited in parallel; keeping BOTH gave 0.34 twice — a walk at 0.116x
   * the ordinary pace, which the spectacle suite caught within the minute.
   *
   * The export stays, and stays honest: `applyFeelSettings` calls it, and it
   * still answers "how many bodies in this world walk on demand" — which is
   * now every local one, because the gait is in their update rather than
   * bolted onto it. Deleting the name would be a bigger edit than leaving a
   * function that tells the truth.
   */
  if (!world) return 0;
  let n = 0;
  for (const p of world.players || []) {
    if (!p || p.isRemote || p.isLocal === false || typeof p.update !== 'function') continue;
    n++;
  }
  return n;
}

/**
 * THE SEAM BETWEEN THE FRAME AND THE THINGS THAT ONLY LOOK AT IT.
 *
 * Two jobs, one wrapper, because both are about the same call.
 *
 * ── 1. HAND THE PRESENTATION LAYER THE INPUT THAT IS ALREADY GOING PAST.
 *
 * `HUD.update(dt, world, player, camera)` is the one call main.js makes every
 * frame with everything on screen in hand, and it has never been given the
 * input — which was fine while the HUD only ever DREW things. It is not fine
 * for a wheel you hold a key to open or a camera you press a key to detach:
 * both are presentation, neither belongs in World, and neither can exist
 * without knowing what is held down.
 *
 * So the input is remembered off the call World already receives. It is a
 * REFERENCE and not a copy, which is the whole reason this works while the
 * world is stopped: main.js keeps running `input.begin()`/`input.end()` on
 * every frame regardless of `paused`, so the object stays live even though
 * `World.update` returns on its first line. That is exactly what a free camera
 * needs — the frozen world's own input.
 *
 * `liveInput` and not `input`, deliberately: World.js belongs to another lane
 * and may well want `this.input` for itself, and a field that quietly means two
 * things is the shape of bug this project keeps a table for.
 *
 * ── 2. AND STOP THE GAME WHILE THE CAMERA IS OFF THE BODY.
 *
 * `FreeCam` also writes `world.paused`, which is World.update's own first line
 * and the right STATE for anything else that asks. It is not enough on its own,
 * and the frame order is why: main.js runs `world.update` BEFORE `hud.update`,
 * so anything that writes `paused = false` between two HUD frames — its own
 * `resume()`, after a pause menu raised over a free camera — buys the game one
 * full frame of simulation before the camera can re-assert itself. One frame is
 * enough to see a wave assemble, and a detached camera over a running world is
 * a wallhack rather than a screenshot tool.
 *
 * A gate here cannot leak that frame, because it IS the call. Measured in
 * tools/checks/spectacle.mjs: the world clock does not move by a single
 * millisecond across seventy frames, including ten after something else has
 * un-paused it.
 *
 * Idempotent.
 */
export function tapFrame(world) {
  if (!world || typeof world.update !== 'function' || world._frameTapped) return false;
  const update = world.update.bind(world);
  world.update = (dt, input) => {
    world.liveInput = input || world.liveInput;
    if (world.freeCamera) return;
    update(dt, input);
  };
  world._frameTapped = true;
  return true;
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
    // The walk's share is READ off WALK_SCALE rather than typed as "a third".
    // Every number this grid has ever typed by hand has eventually described a
    // game that stopped existing — see the Focus row, which said "a third" for a
    // whole round after the dilation was deepened to 0.18.
    text: k => `Move. ${k('sprint')} sprint, ${k('crouch')} crouch, ${k('walk')} slow walk `
      + `(${Math.round(WALK_SCALE * 100)}% pace — hold it, it is not a mode).` },
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
    // The ratio is READ, not typed. This row said "slows to a third" against a
    // real heldScale of 0.18 — the round that deepened the slow-motion from
    // 0.35 moved the number in Focus.js and left the only page that teaches the
    // game quoting the old one, while the Training panel two tabs away printed
    // the true 0.18. A player calibrating a volley against "a third" is timing
    // against a game that stopped existing.
    text: () => `<b>Focus</b> — hold to bend time. The world slows to `
      + `${(FOCUS.heldScale * 100).toFixed(0)}% of real time, you barely do. Burns `
      + `${FOCUS.drain} Force a second, so pick your volleys.` },
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
  { keys: ['unleash'],
    text: () => 'Unleash — a full circle of Force, thrown outward with both arms. It staggers '
      + 'everything within eleven metres and costs more than any other power. For when there is '
      + 'no direction left to face.' },
  { keys: ['compel'],
    text: () => 'Force compel, once <b>Domination</b> is drafted. The unit you are looking at '
      + 'turns on its own — or, alone, on itself.' },
  { keys: ['swap'],
    text: () => 'Standing over a fallen hilt, take it — crystal, hilt and all, so a friend\'s '
      + 'blade is theirs in your hand. Standing over nothing, put yours down.' },
  { keys: ['view'], text: () => 'Toggle first / third person.' },
  { keys: ['scoreboard'], hold: true, text: () => 'Scoreboard &amp; run boons.' },
  // The slot count is read off the table, so a ninth emote changes this line.
  { keys: ['emote'], hold: true,
    text: () => `Emote wheel — ${EMOTES.length} things to say, in your own voice. `
      + 'Hold it, move the mouse to a slot, let go.' },
  { keys: ['freecam'],
    text: () => '<b>Free camera</b> — the view comes off your body and the game '
      + 'STOPS while it is off. Fly it with the movement keys; press again to put it back.' },
  { keys: ['lessonNext', 'lessonBack', 'lessonRepeat'],
    // "In the Dojo" named a level that has been deleted; training is a MODE now
    // and runs in whichever theatre the player picked. See MODES.training.
    text: () => 'In <b>Training</b>: next lesson, previous lesson, start this one again.' },

  /**
   * THE ORDERS, GENERATED — six rows nobody typed.
   *
   * Every other row above names an action and lets the renderer print its live
   * binding, which is what stops a key name going stale. These rows go one step
   * further: the ROW ITSELF comes off `FORMATIONS`, through the registry
   * `registerOrders` filled at the top of this file. Add a seventh formation in
   * Command.js and it gets an action, a rebindable row in Options, a line here
   * and a conflict warning, without a character being written in this file.
   *
   * A heading rather than six sentences each saying "in Command mode": the
   * `head` row is a section title in the grid, and it is the only hand-written
   * string in the whole block.
   */
  { head: 'Commanding an army' },
  ...ORDER_ACTIONS.map(o => ({
    keys: [o.action],
    text: () => `<b>${o.name}</b> — ${o.blurb}`,
  })),
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
    // A SECTION TITLE, and it carries no key at all. It is an <h4> rather than
    // a <div> so that everything measuring this grid — the row parser in
    // tools/checks/controls.mjs included — goes on seeing exactly the rows a
    // player can press, and a heading can never be mistaken for one.
    if (row.head) return `<h4 class="codex-head">${escKey(row.head)}</h4>`;
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
    // …and the same treatment for the clothes, for the same reason: a blob
    // written before a piece existed is missing keys, and a cut id that has
    // been renamed since must fall back to the shipped garment rather than
    // leaving a character with no cape at all. See wardrobeOf in Cloth.js.
    s.wardrobe = wardrobeOf(s.wardrobe);
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
 * How far in the preview can be walked, and the three shots it can be sent to.
 *
 * 5x is the point at which a human head fills the box; past it the near plane
 * starts clipping the shoulder the camera is looking over, and there is
 * nothing behind a procedural face worth seeing at that range.
 *
 * `focus` is in units of the figure's own half-height, so FACE lands on a face
 * whatever species is in the box and whatever build slider says — a fixed
 * metre offset would frame a human's chin and Yoda's species' knees. HILT is
 * negative because the weapon hangs BELOW the middle of a standing figure:
 * GRIPS.two.offset puts the hands about 20 cm under the chest.
 */
export const PREVIEW_ZOOM_MAX = 5;
export const PREVIEW_SHOTS = [
  { id: 'full',  label: 'Full',  zoom: 1,    focus: 0 },
  { id: 'face',  label: 'Face',  zoom: 3.4,  focus: 0.72 },
  { id: 'blade', label: 'Blade', zoom: 2.6,  focus: -0.18 },
];

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
 *
 * Those five numbers are no longer TYPED here — they are CAPE_CUTS.cloak's,
 * which is the same five and is the row the wardrobe's default names. That is
 * what stops "Jedi Cloak" and "the cape the game builds" being two garments
 * that merely happen to agree, and the check above still measures the preview
 * against Player.js rather than against the table.
 */
export function dressPreviewFigure(host, built, cut, wardrobe) {
  const rig = built.rig;
  /*
   * THE WARDROBE, and why it is the fourth argument rather than read off `s`.
   *
   * Everything else in here is Player._makeCloak's, to the number. The pieces
   * are the same: `cape`, `tabard` and `sash` are cut ids that reach the same
   * two functions the game reaches, and the dimensions of the shipped cape now
   * come out of CAPE_CUTS.cloak rather than being typed here — which is what
   * lets the four other capes exist at all, since `withCape` only fills in
   * fields the caller left alone.
   *
   * Left out (a check, an older caller) it is the shipped set, so a preview
   * asked for nothing but a cut is exactly the preview that shipped.
   */
  const w = wardrobeOf(wardrobe);
  const mat = built.palette.outer.clone();
  mat.side = THREE.DoubleSide;
  const tmat = (built.palette.over || built.palette.outer).clone();
  tmat.side = THREE.DoubleSide;
  const cloak = attachCloak(host, rig, {
    material: mat, cut, cape: w.cape, tabard: w.tabard, tabardMaterial: tmat,
    seed: PREVIEW_SEED.cloak,
  });
  let skirt = null;
  if (built.robeSkirt) {
    const smat = (built.palette.over || built.palette.outer).clone();
    smat.side = THREE.DoubleSide;
    skirt = attachSkirt(host, rig, { material: smat, rigid: built.robeSkirt, cut,
      seed: PREVIEW_SEED.skirt, sashMaterial: built.palette.trim, sash: w.sash });
    if (cloak) cloak.outer = skirt;
  }
  // The tones, on the figure and on the garments at once — the skirt's cloth
  // and the cape's are clones the builder never sees, so a palette-only tint
  // would leave the two largest surfaces on the character unchanged.
  tintWardrobe(built, w, { skirt, cape: cloak });
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
  const { cloak, skirt, lekku } = dressPreviewFigure(host, built, s.robeCut, s.wardrobe);
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
/**
 * ZOOM AND FOCUS, added on the report "you should be able to zoom into the
 * preview image to better see the customizations, or even zoom on the saber,
 * it's too far away".
 *
 * Both default to the identity — `zoom: 1` and `focus: 0` — and `d / 1` and
 * `y + 0` are exact, so a caller that passes neither gets the camera this
 * function has always produced. tools/checks/preview.mjs measures the fit at
 * 24 bearings and does not pass either.
 *
 * The zoom divides the SOLVED distance rather than fighting the solver: the
 * fit is still computed against the whole figure, and then the camera walks in
 * along the same axis. That way zooming never changes what "framed" means, and
 * zooming back out lands exactly where it started rather than somewhere the
 * iteration happened to converge.
 *
 * `focus` slides the look-at up the figure in units of its own half-height, so
 * +1 is the crown and -1 the feet whatever species is in the box — a fixed
 * metre offset would put a human's face and Yoda's species' face in different
 * places, which is the same defect that had the blade floating over its head.
 */
export function framePreviewCamera(camera, content, opts = {}) {
  const { pitch = 0, aspect = camera.aspect, margin = PREVIEW_VIEW.margin,
    zoom = 1, focus = 0 } = opts;
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
  // The point the camera orbits and looks at. `half` is the figure's own
  // half-height, so this is species-independent by construction.
  const fy = focus * half;
  const at = (d) => {
    camera.position.copy(dir).multiplyScalar(d).setY(camera.position.y + fy);
    camera.near = Math.max(0.02, d * 0.02);
    camera.far = d * 3 + 8;
    camera.lookAt(0, fy, 0);
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
    if (Math.abs(worst - want) < 0.002) return { distance: at2(d, zoom), fill: worst, zoom };
    d = clamp40(d * worst / want);
  }
  return { distance: at2(d, zoom), fill: at(d), zoom };

  /* Walk in along the solved axis. Separated from `at` so the ITERATION never
   * sees the zoom — an earlier draft folded it into the fit and the solver
   * then converged on "the figure fills the frame at 3x", which is not a zoom,
   * it is a smaller figure. */
  function at2(dist, z) {
    const d2 = clamp40(dist / Math.max(0.25, z));
    at(d2);
    return d2;
  }
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
      netStatus: document.getElementById('net-status'),
      netCode: document.getElementById('net-code'),
      netRoster: document.getElementById('net-roster'),
      netLeave: document.getElementById('btn-leave'),
      restart: document.getElementById('btn-restart'),
      gpu: document.getElementById('gpu-line'),
      build: document.getElementById('build-id'),
      buildLine: document.getElementById('build-line'),
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
    // How much of a column is below the fold is a function of the window, so it
    // is re-answered when the window changes. Registered once, on the object
    // that lives as long as the page.
    globalThis.addEventListener?.('resize', () => this._onPanelShown());
    this.el.build.textContent = 'r1.0';
    // …and neither the build id nor the adapter string is on screen until the
    // player asks for the instruments. See _syncDiag.
    this._syncDiag();
  }

  /* ── boot ────────────────────────────────────────────────────────── */

  progress(fraction, message) {
    this.el.bootFill.style.width = `${Math.round(fraction * 100)}%`;
    if (message) this.el.bootMsg.textContent = message;
  }
  hideBoot() { this.el.boot.classList.add('hidden'); }
  showMenu() {
    this.el.menu.classList.remove('hidden');
    // The panel had no layout while the screen was hidden, so this is the first
    // frame on which "how much is below the fold" has an answer.
    this._onPanelShown();
  }
  hideMenu() { this.el.menu.classList.add('hidden'); }

  setGpuLine(text) { this.el.gpu.textContent = text; this._syncDiag(); }

  /**
   * THE TITLE SCREEN STOPS OPENING WITH A BUG REPORT.
   *
   * The last two things on the front screen were the WebGL adapter string —
   * "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) …))" on the
   * build every player of this game actually loads — and "build r1.0". A
   * wordmark, five tabs and a driver string. Nothing is deleted, because the
   * one machine that ever needs the adapter name is the one whose owner has
   * gone looking for it: both ride `showPerf`, the Frame counter box, which
   * already means "show me the instruments" and already governs the frame-time
   * readout in the corner of the HUD.
   *
   * The elements stay where they are in the footer's flex row rather than
   * being moved into a box of their own — two in-flow items of one row cannot
   * overlap at any viewport, which is what that row was built to guarantee
   * after `#btn-commune` was found floating over `#gpu-line` at six sizes.
   */
  _syncDiag() {
    const on = !!this.s.showPerf;
    this.el.gpu?.classList.toggle('hidden', !on);
    this.el.buildLine?.classList.toggle('hidden', !on);
  }

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
        // A panel that was display:none has no scroll geometry at all, so the
        // fade and the reveal are computed the moment it becomes the one on
        // screen and not before.
        this._onPanelShown();
      });
      t.addEventListener('mouseenter', () => audio.ui('hover'));
    }
  }

  /**
   * "THERE IS MORE BELOW", SAID BY THE COLUMN THAT HAS MORE BELOW.
   *
   * The Deploy panel's narrow column carries ten cards and two headings — 788 px
   * of them once the button is out of the flow — into a band measured at 466 px
   * at 1920x1080 and 368 px at 1280x720. The cap is `.menu-wrap`'s
   * `height:min(760px,92vh)`, so a bigger monitor does not buy a single pixel:
   * 2560x1440 measures identically to 1920x1080. Scrolling is therefore not a
   * failure of this layout, it IS the layout — but arriving at scrollTop 0 with
   * a list that looks finished is a failure, and that is what shipped: asked in
   * Chromium what was actually on top of each mode card, three of the six read
   * 0.000 at every viewport and the shipped default read 0.369 at 1366x768 and
   * 0.000 at 1280x720, under four difficulty cards that all read 1.000.
   *
   * Two things say otherwise now, and neither is a redesign of the panel:
   *
   *   THE FADE. `.more`/`.less` on the column fade SCROLL_FADE pixels of the
   *   scroller at whichever end still has content behind it, and lift at that
   *   end. Recomputed here rather than in CSS because "is there more" is a
   *   measurement: it changes with the viewport, with the content, and with
   *   every scroll.
   *
   *   THE REVEAL. `_revealMode` scrolls the least it can to put the selected
   *   mode fully on screen and clear of the fade. Measured after: the shipped
   *   default is 1.000 visible and fully hit-testable at 1920x1080, 1600x900,
   *   1440x900, 1366x768, 1280x720, 1152x648 and 2560x1440, at scroll offsets
   *   of 6, 6, 6, 59, 103, 170 and 6 px. The movement is itself the second
   *   signal — a column that shifts under the eye is one the player knows can.
   *
   * Both read the live DOM, which tools/checks/_page.mjs cannot compute; the
   * checks in tools/checks/front-screen.mjs therefore hand these two methods
   * the geometry Chromium measured and assert on the arithmetic they do with
   * it, which is the part that can be wrong.
   */
  _syncScrollHints() {
    for (const box of document.querySelectorAll('.col-scroll')) {
      const col = box.parentElement;
      if (!col) continue;
      if (!box._hintBound) {
        box._hintBound = true;
        box.addEventListener('scroll', () => this._syncScrollHints(), { passive: true });
      }
      // 2 px of slack at each end: a fractional scrollHeight would otherwise
      // leave the fade painted on a list the player has already run out of.
      col.classList.toggle('more', box.scrollHeight - box.clientHeight - box.scrollTop > 2);
      col.classList.toggle('less', box.scrollTop > 2);
    }
  }

  /**
   * Put the chosen mode on screen without moving anything that already is.
   *
   * Not `scrollIntoView({block:'nearest'})`, which aligns the card's bottom
   * edge with the container's bottom edge — and the bottom SCROLL_FADE pixels
   * of that container are the fade, so the card it just revealed arrived with
   * its last line half faded out. Measured at 1366x768 on the shipped default:
   * the second line of Path of the Blade's blurb. So the target band is the
   * client box minus the fade at whichever end the card is off, and the scroll
   * is the smallest one that satisfies it.
   */
  _revealMode() {
    const card = this._modeCards?.get(this.s.mode);
    const box = card?.closest?.('.col-scroll');
    if (!card || !box) return;
    const cr = card.getBoundingClientRect?.(), br = box.getBoundingClientRect?.();
    // A DOM with no layout engine (tools/checks/_page.mjs) answers 0 to every
    // rect; there is nothing to reveal there and nothing to get wrong.
    if (!cr || !br || !(br.height > 0)) return;
    const below = cr.bottom - (br.bottom - SCROLL_FADE);
    const above = (br.top + SCROLL_FADE) - cr.top;
    if (below > 0) box.scrollTop += below;
    else if (above > 0) box.scrollTop -= above;
  }

  /** Whatever the panel on screen needs measured once it has a box. */
  _onPanelShown() {
    this._revealMode();
    this._syncScrollHints();
  }

  /* ── level cards ─────────────────────────────────────────────────── */

  /**
   * A LEVEL'S CARD, DRAWN FROM THE LEVEL.
   *
   * This was a hand-keyed palette — eight `key: [top, bottom]` pairs, plus two
   * `key === 'hangar'` special cases inside the silhouette loop — and by the
   * time the roster moved it was wrong in both directions at once. Four of its
   * eight entries named levels that had been deleted. The five newest levels
   * had no entry at all, so the Ember Shelf, the Temple, the Intake, the Foundry and
   * the Deeps every one of them fell to the same dark default and the same
   * wavy hill: five identical cards, which is a menu telling the player those
   * five places are the same place.
   *
   * Everything here now comes off the level's own atmosphere, ground colour
   * and terrain. A level added tomorrow arrives with art; a level deleted takes
   * its art with it; and no list has to be kept in step by hand.
   *
   * The drawing rules are src/toon/REFERENCE.md's, so the card and the game
   * agree: FLAT bands rather than gradients inside a shape, aerial perspective
   * as a hue shift TOWARD THE SKY rather than a wash of grey, an ink line
   * around each shape, and nothing shiny.
   */
  _levelArt(key) {
    /* 320x112 rather than 320x140, and the composition kept between y=26 and
     * y=100. `.card .art` is a 96 px box filled with `background-size:cover`,
     * so a canvas taller than the box's aspect has its TOP AND BOTTOM cut off —
     * which is where a landscape keeps its sky and its floor. At 2.86:1 a card
     * has to be wider than 275 px before anything vertical is lost, and the
     * margins above and below the composition absorb the rest. the Ember Shelf's
     * fissure and the Foundry's pour were both authored at y=121 and neither
     * was ever on screen. */
    const W = 320, H = 112;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const L = LEVELS[key];
    if (!L) return c.toDataURL();
    const A = L.atmosphere || {};
    const indoor = A.sky === false;

    /* ── colour, in sRGB bytes, because a canvas is not a renderer ─────── */
    const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const css = ([r, gg, b], a = 1) =>
      a >= 1 ? `rgb(${r | 0},${gg | 0},${b | 0})` : `rgba(${r | 0},${gg | 0},${b | 0},${a})`;
    const mix = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
    const shade = (p, t) => mix(p, [8, 9, 12], t);

    const sky = rgb(A.skyColor ?? 0x9fb4d8);
    const sun = rgb(A.sunColor ?? 0xffe2b4);
    const fog = rgb(A.fogColor ?? A.skyColor ?? 0x9fb4d8);
    /* The colour of the ground the player will actually be looking at. A level
     * with grass on it is GREEN, and `groundColor` is the soil underneath it —
     * so the meadow, whose blurb is "hills of long grass", was drawing a card
     * the colour of turned earth. `grassTint[0]` is the near blade colour the
     * field itself is built from, so the card and the level agree by
     * construction rather than by a second number someone has to remember. */
    const ground = rgb(L.grass && L.grassTint ? L.grassTint[0] : (L.groundColor ?? 0x50443c));

    /* THE SKY IS TWO FLAT BANDS, not a gradient. A gradient is the one thing
     * the reference frames never have; the horizon glow is a separate SHAPE
     * that happens to sit under the zenith band. Indoors the same two bands are
     * the far dark of the room and the light coming in at floor level. */
    const zenith = indoor ? shade(sky, 0.72) : sky;
    const horizon = indoor ? shade(fog, 0.35) : mix(sky, sun, 0.45);
    g.fillStyle = css(zenith); g.fillRect(0, 0, W, H);
    g.fillStyle = css(horizon); g.fillRect(0, 40, W, H - 40);

    /* ── the deterministic wobble ──────────────────────────────────────── */
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rand = () => (((h = Math.imul(h ^ (h >>> 15), 2246822507)) >>> 9) % 4096) / 4096;
    const jitter = [];
    for (let i = 0; i < 24; i++) jitter.push(rand());
    const j = (i) => jitter[i % jitter.length];

    /**
     * THE SUN AND THE CLOUD DECK, off the level's own atmosphere.
     *
     * `elevation`, `azimuth`, `cloudCover`, `cloudLit` and `cloudDark` are
     * already authored on every outdoor level — they are what the sky shader
     * runs on — so the card can draw the level's own weather instead of
     * inventing some. the Ember Shelf is 96% covered in ash lit orange from below;
     * the meadow is 42% covered in white; the White Pass is 66% and grey. That
     * is three completely different skies, and the old card had one empty
     * gradient for all of them.
     *
     * Both are FLAT SHAPES WITH AN INK LINE. A soft-edged sun with a radial
     * bloom is the single most photographic thing you can put in a picture,
     * and src/toon/REFERENCE.md's whole seventh rule is that the sky is flat
     * and the clouds are outlined.
     */
    if (!indoor) {
      const elev = A.elevation ?? 25, azim = A.azimuth ?? 180;
      // The card looks along the azimuth, so the sun's screen x is where its
      // bearing falls across a ~150° field, and its y is its elevation.
      const off = (((azim - 180) % 360) + 540) % 360 - 180;
      const sx = W / 2 + (off / 75) * (W / 2);
      const sy = 44 - Math.max(0, Math.min(1, elev / 60)) * 34;
      if (sx > -20 && sx < W + 20) {
        g.fillStyle = css(mix(sun, [255, 255, 255], 0.45), 0.95);
        g.beginPath(); g.arc(sx, sy, 9, 0, Math.PI * 2); g.fill();
        g.strokeStyle = css(shade(sun, 0.25), 0.5); g.lineWidth = 1.5;
        g.beginPath(); g.arc(sx, sy, 13, 0, Math.PI * 2); g.stroke();
      }

      const cover = A.cloudCover ?? 0.4;
      const lit = rgb(A.cloudLit ?? 0xfdf8ee), dark = rgb(A.cloudDark ?? 0x8a97a8);
      const decks = Math.round(2 + cover * 5);
      for (let i = 0; i < decks; i++) {
        const cy = 12 + j(i * 3) * 30;
        const cw = 34 + j(i * 3 + 1) * (40 + cover * 70);
        const cx = -20 + j(i * 3 + 2) * (W + 40);
        const ch = 6 + j(i * 3 + 1) * 7;
        // Two tones and a crisp boundary, which is the first rule in the file:
        // the underside is the dark colour, the top the lit one, and the seam
        // between them is a straight edge.
        const puff = (yy, hh, fill) => {
          g.fillStyle = fill;
          g.beginPath();
          g.moveTo(cx, yy + hh);
          g.arc(cx + cw * 0.28, yy + hh * 0.35, hh * 0.95, Math.PI, 0);
          g.arc(cx + cw * 0.62, yy + hh * 0.15, hh * 1.15, Math.PI, 0);
          g.arc(cx + cw * 0.88, yy + hh * 0.45, hh * 0.8, Math.PI, 0);
          g.lineTo(cx + cw, yy + hh); g.closePath(); g.fill();
        };
        puff(cy, ch, css(dark, 0.55 + cover * 0.4));
        puff(cy - ch * 0.34, ch, css(lit, 0.75 + cover * 0.25));
      }
    }

    /**
     * THE SKYLINE, per terrain rather than per level, because the terrain is
     * what the ground is MADE of and two levels on the same ground should look
     * like the same country. Each returns a height in pixels at x, for a range
     * whose base sits at `base`.
     */
    /** A triangle wave. `abs(sin)` is the obvious jagged-looking thing and is
     *  not jagged at all — it is a row of round humps, which is why the White
     *  Pass came out looking like the meadow. A mountain has straight sides. */
    const tri = (t) => 1 - Math.abs(((t / Math.PI) % 2) - 1) * 2;
    const PROFILE = {
      // long wavelength, one slip face per dune: sand has a preferred shape
      drifts: (x, s) => Math.sin(x * 0.017 + s) * 13 + Math.sin(x * 0.006) * 9
        + Math.max(0, Math.sin(x * 0.017 + s + 1.2)) * 5,
      // straight-sided peaks at two scales, and the amplitude is the point —
      // this is the only skyline in the game the player looks UP at
      alpine: (x, s) => 6 + Math.max(0, tri(x * 0.0138 + s)) * 30
        + Math.max(0, tri(x * 0.062 + s * 2)) * 7,
      // mesas: flat tops, sheer sides, made by quantising a smooth curve
      scoria: (x, s) => Math.round((Math.sin(x * 0.0115 + s) * 20 + Math.sin(x * 0.031) * 7) / 8) * 8,
      // low broken ground with one landmark rise
      arena: (x, s) => Math.sin(x * 0.021 + s) * 8 + Math.sin(x * 0.058) * 4
        + Math.max(0, 22 - Math.abs(x - 232) * 0.5),
      /* Rounded hills, and a treeline in CLUMPS. The first cut tested one sine
       * against a threshold, which puts a tree every 15 px whether or not
       * anything about the hill wanted one, and the card came out with a zip
       * fastener along the top of it. Two incommensurate rates gate each other,
       * so trees come in stands with gaps between them. */
      meadow: (x, s) => Math.sin(x * 0.015 + s) * 11 + Math.sin(x * 0.044) * 4
        + (Math.sin(x * 0.031 + s) > 0.25 && Math.sin(x * 0.55 + s * 3) > 0.1
          ? 7 + Math.sin(x * 0.21) * 3 : 0),
      // a colonnade: an arcade of piers with the gaps cut out of the sky
      temple: (x) => (Math.abs(((x + 13) % 46) - 23) < 9 ? 44 : 18)
        + (Math.abs(x - 160) < 34 ? 14 : 0),
      // stacks and gantries
      works: (x) => 16 + (Math.abs(((x + 7) % 58) - 29) < 6 ? 28 : 0)
        + (x > 92 && x < 128 ? 36 : 0) + (x > 214 && x < 236 ? 24 : 0),
      foundry: (x) => 14 + (Math.abs(((x + 21) % 72) - 36) < 8 ? 32 : 0)
        + (x > 150 && x < 196 ? 28 : 0),
      /* A cave mouth: rock to the top of the frame, with one arch cut out of
       * it. The first cut made the arch a V that dipped to 10 px above the
       * base and left the "wall" only 54 px tall, so it read as a valley
       * between two hills — the opposite picture. Rock has to reach the top
       * edge or there is no cave. */
      cavern: (x) => {
        const d = Math.abs(x - 168) / 82;
        return d >= 1 ? 104 : 104 - 64 * Math.sqrt(1 - d * d);
      },
    };
    const profile = PROFILE[L.terrain] || PROFILE.arena;

    /**
     * THREE RANGES, and the whole aerial-perspective rule in one line: each is
     * mixed TOWARD THE SKY by how far away it is, never toward grey. The far
     * range is 68% sky and reads as distance; the near one is the ground's own
     * colour, darkened.
     */
    /* [air, base, dark]. The bases are HIGH — the nearest range starts at
     * y=84 of 112 — because `cover` trims the bottom of the canvas and the
     * near band is the one carrying the level's own colour. Composed at 96 it
     * came out a ten-pixel sliver and every sand, snow and grass level read as
     * the same pale wash of far-distance blue. */
    const ranges = indoor
      ? [[0.34, 66, 0.40], [0.00, 84, 0.56]]
      : [[0.62, 58, 0.08], [0.32, 70, 0.18], [0.04, 84, 0.28]];
    ranges.forEach(([air, base, dark], i) => {
      const tint = mix(shade(ground, dark), indoor ? horizon : sky, air);
      g.fillStyle = css(tint);
      g.beginPath();
      g.moveTo(-2, H);
      for (let x = -2; x <= W + 2; x += 2) g.lineTo(x, base - profile(x, j(i) * 6.28) * (1 - i * 0.22));
      g.lineTo(W + 2, H); g.closePath();
      g.fill();
      // The ink line, on the ridge only — a drawn edge, not a rim light.
      g.strokeStyle = css(shade(tint, 0.55), 0.9);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = -2; x <= W + 2; x += 2) {
        const y = base - profile(x, j(i) * 6.28) * (1 - i * 0.22);
        if (x < 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    });

    /* the Ember Shelf gets its fissure and the Foundry its pour: one hot line each,
     * because the thing that identifies both places is that the LIGHT comes
     * off the floor. Everything else here is lit from above. */
    if (L.terrain === 'scoria' || L.terrain === 'foundry') {
      g.fillStyle = css(sun, 0.26);
      g.fillRect(0, 82, W, 12);
      g.fillStyle = css(mix(sun, [255, 255, 255], 0.35), 0.92);
      g.fillRect(0, 87, W, 3);
    }

    /* AND THE DEEPS ARE LIT BY THE BLADE, which is the whole blurb: the last
     * room of the Descent has no light of its own. So the nearest edge takes a
     * rim in the crystal's colour, falling off with distance from the hilt —
     * on the four indoor levels it is the only warm thing in the picture, and
     * on the Cut it is the only light at all. */
    if (indoor) {
      const lit = rgb((SABER_COLORS[this.s?.colorIndex ?? 0] || SABER_COLORS[0]).glow);
      const base = 84, prof = PROFILE[L.terrain] || PROFILE.arena;
      g.lineWidth = 2;
      for (let x = -2; x <= W + 2; x += 4) {
        const fall = Math.max(0, 1 - Math.abs(x - 178) / 150) ** 2;
        if (fall < 0.02) continue;
        g.strokeStyle = css(lit, 0.55 * fall);
        g.beginPath();
        g.moveTo(x, base - prof(x, 0));
        g.lineTo(x + 4, base - prof(x + 4, 0));
        g.stroke();
      }
    }

    /* ── the blade, in the crystal the player actually chose ───────────── */
    const cry = SABER_COLORS[this.s?.colorIndex ?? 0] || SABER_COLORS[0];
    const blade = rgb(cry.hex), glow = rgb(cry.glow);
    g.strokeStyle = css(glow, 0.95);
    g.lineWidth = 3;
    g.shadowColor = css(blade, 0.95); g.shadowBlur = 14;
    g.beginPath(); g.moveTo(172, 88); g.lineTo(188, 40); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = css(mix(glow, [255, 255, 255], 0.8), 1);
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(172, 88); g.lineTo(188, 40); g.stroke();
    g.fillStyle = 'rgba(10,12,16,0.92)';
    g.fillRect(168, 86, 8, 14);
    return c.toDataURL();
  }

  /**
   * MAKE A PICKER A CONTROL — FOCUSABLE, ACTIVATABLE, ANNOUNCED.
   *
   * Every picker in this menu was a bare `<div>` with a `click` listener and
   * nothing else. Counted on the real Menu built against the real page: 192
   * click targets across the level cards, difficulties, modes, fidelity tiers,
   * schemes, deflection models, the eleven creator rows and the key chips, and
   * ZERO of them reachable by keyboard — the whole front end a player without a
   * mouse could operate was the five tabs and the Ignite button, both of which
   * are real `<button>`s and got it for free. The mid-run boon draft was worse
   * than unreachable: it stops the world, its only exits are clicks on `.dc`
   * divs, and Escape opens the pause card whose Resume puts the draft straight
   * back — draft, pause, draft, with Abandon run the only way out of a wave
   * already won.
   *
   * One helper rather than a tag change, for two reasons. The cards contain
   * block content (`<div class="art">`, `<div class="meta">`), which a `<button>`
   * may not legally hold; and this codebase has the other failure already on
   * file — SkillTree.js sets `tabindex="0"` and `role="button"` on every star
   * and registers only `click` and `dblclick`, so a focused star announces
   * itself as a button and does nothing when activated. A single function that
   * always does all three is the only version of this that cannot drift apart.
   *
   * Space is prevented explicitly because its default on a focused element is
   * to scroll the panel out from under the thing the player just chose.
   */
  _activate(el, onActivate, label = null) {
    if (!el) return el;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    // The swatch rows are the reason this falls back to `title`: a crystal or a
    // robe is a coloured square with no text in it at all, so without a name
    // here a screen reader reads nine identical "button"s. Every swatch already
    // sets `title` for the tooltip; this is the same word.
    const name = label ?? el.title;
    if (name) el.setAttribute('aria-label', name);
    const fire = (e) => { e?.preventDefault?.(); onActivate(e); };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') fire(e);
    });
    return el;
  }

  /**
   * HOW MANY KINDS OF THING A THEATRE FIELDS.
   *
   * `pool` is a WEIGHTED BAG, not a roster — src/game/Waves.js:910 says so in
   * its own words ("Uniform pick from the level's pool, which is already
   * weighted by repeats") and picks from it uniformly by index, so a repeated
   * key is a weight and not a second kind of enemy. The card printed
   * `pool.length` and called it "unit types", which made twelve of the thirteen
   * cards overstate themselves: measured over LEVEL_ORDER, scoria 8→6,
   * temple 8→4, warship 9→5, colosseum 9→7, wood 8→6, kamino 8→6, meadow 7→6,
   * drifts 8→7, arena 9→8, intake 7→5, foundry 8→6, deeps 8→6, with only alpine
   * honest and only because its pool happens to have no repeats. 25 phantom
   * types across the front screen, and the worst card doubled its own roster.
   *
   * It matters because that badge is the one hard number on the largest control
   * of the first screen, so it is what a player compares theatres by — and the
   * ranking it gave was wrong, not merely inflated: warship, colosseum and arena
   * all read "9" against true counts of 5, 7 and 8.
   *
   * The unique count is the whole roster a level can field, not an
   * approximation of it: `WaveDirector._setPiece` filters its ladder through
   * `this.pool.includes(...)`, `_compose` and `_sandboxType` draw from the pool
   * by index, and champion/elite promotion produces `type|mod` variants of a
   * body already in the bag rather than a new one.
   */
  _poolTypes(L) { return new Set(L.pool).size; }

  _buildLevels() {
    this.el.levels.innerHTML = '';
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const card = document.createElement('div');
      card.className = 'card' + (this.s.level === key ? ' sel' : '');
      card.innerHTML = `
        <div class="art" style="background-image:url(${this._levelArt(key)});background-size:cover"></div>
        <div class="tagpill">${this._poolTypes(L)} unit types</div>
        <div class="meta"><b>${L.name}</b><span>${L.blurb}</span></div>`;
      this._activate(card, () => {
        // Ignored in the modes that choose their own place — see _syncTheatre.
        // The guard is here as well as on pointer-events because a card the
        // keyboard can still reach must not write a setting the game discards.
        if (this._theatreInert) return;
        audio.ui('click');
        this.s.level = key;
        [...this.el.levels.children].forEach(c => c.classList.toggle('sel', c === card));
        saveSettings(this.s);
      });
      card.addEventListener('mouseenter', () => audio.ui('hover'));
      this.el.levels.appendChild(card);
    }
    this._syncTheatre();
  }

  /**
   * THE THEATRE COLUMN, WHEN THE MODE HAS ALREADY CHOSEN THE THEATRE.
   *
   * Nothing does, today — the Descent was the one mode that owned its own
   * ladder of levels, and it is deleted. This stays because the mechanism is
   * the answer to a real defect and the next mode that picks its own ground
   * (Command is one) needs it: a card that is lit, written to settings and
   * then thrown away reads as the picker being randomly broken, and it stuck
   * — the level the player thought they picked turned up in the NEXT run of
   * some other mode.
   *
   * `MODES[key].fixedTheatre` is the switch. A mode declares it; this reads it.
   * That is one authority rather than a mode name repeated in the front end.
   */
  _syncTheatre() {
    const host = this.el.levels;
    if (!host) return;
    const inert = !!MODES[this.s.mode]?.fixedTheatre;
    this._theatreInert = inert;
    host.classList.toggle('inert', inert);
    for (const card of host.children) {
      card.tabIndex = inert ? -1 : 0;
      card.setAttribute('aria-disabled', inert ? 'true' : 'false');
    }
    const note = document.getElementById('level-note');
    if (note) {
      note.textContent = inert ? MODES[this.s.mode].fixedTheatre : '';
      note.classList.toggle('hidden', !inert);
    }
  }

  _buildDifficulty() {
    this.el.diffs.innerHTML = '';
    for (const [key, D] of Object.entries(DIFFICULTY)) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.difficulty === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${D.name}</b><span>${D.blurb}</span></div>`;
      this._activate(d, () => {
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
      this._activate(d, () => { audio.ui('click'); this.selectMode(key); });
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
    // The Descent picks its own places; the Theatre column has to say so the
    // moment the mode changes, not after the player has deployed into a level
    // they did not choose.
    this._syncTheatre();
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
      this._activate(sw, () => {
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
      this._activate(sw, () => {
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
      this._activate(card, () => {
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
      this._activate(sw, () => {
        audio.ui('click');
        this.s.robeIndex = i;
        [...this.el.robes.children].forEach(x => x.classList.toggle('sel', x === sw));
        saveSettings(this.s);
        // The whole panel, not just this row: every "as the robe" swatch below
        // is painted with the tone this palette derives, so a robe picked here
        // moves nine other swatches. Repainting them is what makes "leave this
        // piece alone" a thing a player can SEE rather than infer.
        this._buildSaber();
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
    /**
     * HAIR AND BEARD BELONG TO THE SPECIES, exactly as the skin rack does.
     *
     * These two rows were handed HAIR_STYLES and BEARD_STYLES unconditionally,
     * and src/game/Bodies.js ends the whole hair-and-beard block with a single
     * `if (!sp.hair) return;` — so on the five species that declare
     * `hair: false` (Zabrak, Twi'lek, Togruta, Nautolan, Kel Dor) the creator
     * offered fifteen named cards, each with its own descriptive subtitle, and
     * every one of them built the same figure. Measured by hashing the built
     * body once per (species × card): human 8/8 hairstyles and 7/7 beards
     * distinct, smallfolk the same, and all five hairless species 1/8 and 1/7.
     * 75 of 105 (species, card) pairs were dead controls.
     *
     * The creator already knew how to do this — six lines above, the skin rack
     * is re-homed per species and the row correctly steps 10 swatches → 8 — so
     * this is the same rule applied to the row that needed it more. The
     * condition is the SPECIES RECORD'S OWN `hair` field, read through
     * `speciesOf`, which is the identical field the builder gates on; a copy of
     * the list of hairless species would be a fourth place for it to drift.
     * `_sheetCardRow` already hides its own heading when it is handed nothing,
     * so a Twi'lek gets no Hair title over an empty box, and the species picker
     * at :1816 already rebuilds these rows through `_buildForge`, so choosing
     * Human again brings all fifteen back.
     */
    const sp = speciesOf(this.s.species);
    this._sheetCardRow('hairstyle-list', 'h-hairstyle', 'hair', sp.hair ? HAIR_STYLES : []);
    this._sheetCardRow('beard-list', 'h-beard', 'beard', sp.hair ? BEARD_STYLES : []);
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

    /*
     * ── THE REST OF THE CLOTHES ────────────────────────────────────────────
     *
     * "You can only change the lower robe… I want to be able to change all the
     * clothes and also be able to choose from different capes or even go
     * capeless." Six rows of tone and three of cut, all of them writing into
     * `this.s.wardrobe` through `_wear`, which is the one place that object is
     * rebuilt and saved — the same shape `_sheet` has for the character sheet
     * and for the same reason.
     *
     * Each tone row's FIRST swatch is "as the robe", painted with the tone the
     * builder would actually derive from the robe palette in the row above. It
     * is not a grey placeholder: a player has to be able to see what leaving a
     * piece alone gets them, and that answer changes every time the robe
     * colour does — which is why these rows are rebuilt with the panel.
     */
    this._wardrobeCards('cape-list', 'h-cape', 'cape', CAPE_CUTS);
    this._wardrobeTones('cape-tone-list', 'capeTone', 'outer');
    this._wardrobeCards('tabard-list', 'h-tabard', 'tabard', TABARD_CUTS);
    this._wardrobeTones('tabard-tone-list', 'tabardTone', 'over');
    this._wardrobeTones('tunic-tone-list', 'tunicTone', 'inner');
    this._wardrobeCards('sash-list', 'h-sash', 'sash', SASH_CUTS);
    this._wardrobeTones('sash-tone-list', 'sashTone', 'trim');
    this._wardrobeTones('boot-tone-list', 'bootTone', 'leather');
    this._wardrobeTones('glove-tone-list', 'gloveTone', 'leather');

    this._slider('opt-build', 'build', (v) => (v < 0.34 ? 'slight' : v > 0.66 ? 'heavy' : 'even'),
      () => this._refreshPreview(true));
    // 'saber', not true: neither of these is a new body. See _reforgeSaber.
    this._slider('opt-bladelen', 'bladeLength', (v) => `${v.toFixed(2)}m`, () => this._refreshPreview('saber'));
    this._slider('opt-bladewidth', 'coreWidth', (v) => `${Math.round(v * 100)}%`, () => this._refreshPreview('saber'));
  }

  /**
   * BIND ONE SLIDER — ONCE PER ELEMENT, HOWEVER OFTEN THE PANEL IS REBUILT.
   *
   * This function is called from _buildSaber for the three appearance sliders
   * (Frame, Length, Core width), and _buildSaber re-runs on every Order pick
   * and every Species pick. The inputs themselves are static markup in
   * index.html and are never recreated, so both the `input` listener and the
   * push into `entry.inputs` used to stack: measured on the real Menu against
   * the real page, three picks left `opt-build` carrying FOUR 'input'
   * listeners and `_bound.get('build').inputs.length === 4`, and one drag event
   * on the Frame slider produced four `_refreshPreview(true)` calls — four full
   * figure rebuilds, cloth, hair and robe included, per pointer move, against a
   * single rebuild this file's own note already measures at 73-234 ms.
   *
   * The guard is the one `_sheetSlider` has carried twelve lines below for the
   * same reason, which is why `sheet-muscle` and `sheet-age` stayed at one
   * listener through the same three rebuilds while these three went to four.
   * Keyed on the element, so a second CONTROL for the same setting (Length has
   * one in the forge and one in the training panel) still registers, and its
   * own listener still only registers once.
   */
  _slider(id, key, fmt, onChange) {
    const input = document.getElementById(id);
    if (!input) return;
    const entry = this._bound.get(key) || { inputs: [], fmt, onChange };
    // First registration owns the formatter and the side effect; later ones are
    // extra handles on the same number.
    if (fmt && !entry.fmt) entry.fmt = fmt;
    if (onChange && !entry.onChange) entry.onChange = onChange;
    if (!entry.inputs.includes(input)) entry.inputs.push(input);
    this._bound.set(key, entry);
    if (!input.dataset.sliderBound) {
      input.dataset.sliderBound = '1';
      input.addEventListener('input', () => this._set(key, parseFloat(input.value)));
    }
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

  /**
   * THE BLOOM BOX, WHICH THE PERFORMANCE TIER OVERRULES.
   *
   * `QUALITY.low.bloom` is false, and main.js's reader ANDs the tier column
   * with the player's checkbox — so on Performance the box could not change
   * anything, and it still painted itself ticked because it paints from
   * `settings.bloom`, which defaults to true. Untick it, tick it, nothing
   * happens either way, and no card or hint said why. That is the dead-control
   * shape SETTING_READERS was written to prevent, arriving from the tier side
   * where a reader check cannot see it.
   *
   * Disabled and relabelled rather than hidden: the player's own preference is
   * still there and comes straight back when they leave the tier — the setting
   * is untouched, only the control's appearance follows the tier.
   */
  _syncBloomBox() {
    const box = document.getElementById('opt-bloom');
    if (!box) return;
    const tier = (QUALITY[this.s.quality] ?? QUALITY.high).bloom !== false;
    box.disabled = !tier;
    box.checked = !!this.s.bloom && tier;
    const label = document.getElementById('opt-bloom-label');
    if (label) label.textContent = tier ? 'Bloom' : 'Bloom — off on Performance';
    const row = document.getElementById('opt-bloom-row');
    if (row) row.classList.toggle('overruled', !tier);
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
      yaw: 0.4, pitch: 0.1, t: 0, content: null, cloth: [], w: 0, h: 0,
      // 1 frames the whole figure, which is where this has always been.
      zoom: 1, focus: 0, shot: 'full' };
    this._refreshPreview(true);
    this._buildShotBar();

    let lastX = 0, lastY = 0;
    host.addEventListener('pointerdown', (e) => { this.preview.drag = true; lastX = e.clientX; lastY = e.clientY; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointerup', (e) => { this.preview.drag = false; host.releasePointerCapture?.(e.pointerId); });
    host.addEventListener('pointermove', (e) => {
      if (!this.preview.drag) return;
      this.preview.yaw += (e.clientX - lastX) * 0.01;
      this.preview.pitch = Math.max(-1.1, Math.min(1.1, this.preview.pitch + (e.clientY - lastY) * 0.008));
      lastX = e.clientX; lastY = e.clientY;
    });
    /**
     * THE WHEEL ZOOMS. `passive: false` and a preventDefault, because the
     * forge column scrolls and a wheel over the preview would otherwise scroll
     * the list behind it while zooming — two things at once, which reads as
     * neither working.
     *
     * Multiplicative rather than additive so a notch is the same proportion of
     * the view at every zoom; that is what makes it feel like a lens instead of
     * a slider.
     */
    host.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.preview;
      if (!p) return;
      p.zoom = Math.max(1, Math.min(PREVIEW_ZOOM_MAX, p.zoom * (e.deltaY > 0 ? 0.88 : 1.136)));
      // Zooming by hand leaves the named shots behind — the buttons say where
      // the camera IS, and after a wheel it is nowhere any of them named.
      if (p.shot !== 'free') { p.shot = 'free'; this._syncShotButtons(); }
    }, { passive: false });

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

  /**
   * The three named shots under the preview, plus what the wheel does.
   *
   * Built here rather than typed into index.html for the reason every list in
   * this front end is: PREVIEW_SHOTS is the authority for how many there are
   * and what each is called, and a row of buttons in the markup is a second
   * copy of that list waiting to disagree with it.
   */
  _buildShotBar() {
    const host = document.getElementById('preview-shots');
    if (!host) return;
    host.innerHTML = '';
    this._shotButtons = new Map();
    for (const shot of PREVIEW_SHOTS) {
      const b = document.createElement('button');
      b.className = 'shot';
      b.textContent = shot.label;
      this._activate(b, () => {
        audio.ui('click');
        const p = this.preview;
        if (!p) return;
        p.zoom = shot.zoom; p.focus = shot.focus; p.shot = shot.id;
        this._syncShotButtons();
      });
      this._shotButtons.set(shot.id, b);
      host.appendChild(b);
    }
    this._syncShotButtons();
  }

  _syncShotButtons() {
    if (!this._shotButtons) return;
    const at = this.preview?.shot ?? 'full';
    for (const [id, b] of this._shotButtons) b.classList.toggle('sel', id === at);
  }

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
      this._activate(d, () => {
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
      this._activate(d, () => {
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

  /**
   * Write one piece of the wardrobe, rebuild it, save it, and re-dress.
   *
   * The ONE place `this.s.wardrobe` is written — `_sheet`'s shape, and the
   * reason is the same: nine controls each doing their own spread is nine
   * chances to drop a key, and `wardrobeOf` has to run on the way through or a
   * control could store an id the garment layer will not recognise.
   *
   * `onWardrobe` is live: the seam re-dresses whatever is standing in the
   * world, so a cape chosen from the pause card lands on the body without a
   * redeploy — which is the whole reason the wardrobe is applied from a seam
   * rather than at spawn.
   */
  _wear(key, value) {
    this.s.wardrobe = wardrobeOf({ ...this.s.wardrobe, [key]: value });
    saveSettings(this.s);
    this.hooks.onFeel?.(this.s);
    this._refreshPreview(true);
  }

  /** A card row bound to a key of the wardrobe rather than to a setting. */
  _wardrobeCards(hostId, headId, key, list) {
    const host = document.getElementById(hostId), head = headId && document.getElementById(headId);
    if (!host) return;
    host.innerHTML = '';
    const w = wardrobeOf(this.s.wardrobe);
    for (const it of list) {
      const d = document.createElement('div');
      d.className = 'diff' + (w[key] === it.id ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${it.name}</b><span>${it.blurb || ''}</span></div>`;
      this._activate(d, () => {
        audio.ui('click');
        this._wear(key, it.id);
        [...host.children].forEach(x => x.classList.toggle('sel', x === d));
      });
      host.appendChild(d);
    }
    if (head) head.style.display = list.length ? '' : 'none';
  }

  /**
   * A row of garment tones, with "as the robe" first.
   *
   * `from` names which tone of the chosen ROBE_COLORS palette this piece is
   * derived from, so the leading swatch shows the real answer rather than a
   * grey square: `over` is the mix the builder makes for the over-cloth,
   * `leather` is the one tone on the figure that is not derived from the robe
   * at all. Those derivations are Bodies.js's; the two that are a MIX are
   * restated here, which is a copy — the alternative was exporting three more
   * constants from a file this workstream may not edit this round, and the
   * cost of being wrong is one swatch that is slightly the wrong brown.
   */
  _wardrobeTones(hostId, key, from) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const R = ROBE_COLORS[this.s.robeIndex ?? 0] || ROBE_COLORS[0];
    const mix = (a, b, t) => {
      const c = (x, s) => (x >> s) & 255;
      const l = (x, y) => Math.round(x + (y - x) * t);
      return (l(c(a, 16), c(b, 16)) << 16) | (l(c(a, 8), c(b, 8)) << 8) | l(c(a, 0), c(b, 0));
    };
    const derived = from === 'inner' ? R.inner
      : from === 'trim' ? R.trim
        : from === 'over' ? mix(R.outer, R.trim, 0.46)
          : from === 'leather' ? 0x53412f : R.outer;
    const rack = [{ name: 'As the robe', hex: derived, index: -1 },
      ...GARMENT_TONES.map((t, i) => ({ ...t, index: i }))];
    const w = wardrobeOf(this.s.wardrobe);
    host.innerHTML = '';
    for (const c of rack) {
      const sw = document.createElement('div');
      sw.className = 'sw' + (w[key] === c.index ? ' sel' : '') + (c.index < 0 ? ' as-robe' : '');
      sw.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      sw.title = c.name;
      this._activate(sw, () => {
        audio.ui('click');
        this._wear(key, c.index);
        [...host.children].forEach(x => x.classList.toggle('sel', x === sw));
      }, c.name);
      host.appendChild(sw);
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
      this._activate(sw, () => {
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
    framePreviewCamera(p.camera, p.content,
      { pitch: p.pitch, aspect: w / h, zoom: p.zoom, focus: p.focus });
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
          <b>Sandbox</b> mode in any theatre and in <b>Training</b>, and nowhere else —
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
      <div class="col narrow pinned">
        <div class="col-scroll">
        <h3>Blade</h3>
        <label class="check"><input type="checkbox" id="opt-unlimited-blade"> Unlimited blade length</label>
        <label class="check"><input type="checkbox" id="opt-unlimited-focus"> Unlimited Focus</label>
        <p class="hint">Focus costs ${FOCUS.drain} Force a second, which is the trade the whole system exists
          to create — every second inside it is a push you cannot make. Off the leash it costs
          nothing, so you can sit inside a volley for as long as it takes to learn to read one.
          The world still runs at ${FOCUS.heldScale.toFixed(2)} of real time and you still run at
          ${FOCUS.playerScale.toFixed(2)} of yours; what goes away is the bill.</p>
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
        <h3 style="margin-top:22px">The lessons</h3>
        <p class="hint">${LESSONS.length} of them, in order, in whatever theatre you have picked
          under <b>Deploy</b>: meeting a bolt, driving into one, sending it home, the cut, the
          parry, the chamber, the blade lock. A coach panel calls each one and counts it off, and
          nothing in the room can kill you.</p>
        <p class="hint" style="margin-top:auto">The sandbox is the same room without the coach:
          the theatre picked under <b>Deploy</b>, the three controls on this page, and nothing
          arrives until you ask for it.</p>
        </div>
        <button id="btn-lessons" class="primary">Begin the lessons</button>
        <button id="btn-sandbox" class="secondary">Enter the sandbox</button>
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

    /**
     * THE TAB CALLED TRAINING NOW STARTS TRAINING.
     *
     * It had exactly one button and that button deployed SANDBOX. Enumerated in
     * Chromium: the panel's headings were ['The room', 'Opponent', 'Blade'] and
     * its buttons were [{id:'btn-sandbox', text:'Enter the sandbox'}] — one, and
     * not a Training one. Clicking it gave settings.mode 'sandbox', a
     * WaveDirector, a hidden coach panel still holding index.html's placeholder
     * '—', and a HUD counting WAVES; `DojoDirector`, the class that owns the
     * lessons, was never constructed. `grep -n 'selectMode(' src/ui/Menu.js`
     * returned three lines — the mode card, this button, and the definition —
     * so the ONLY writer of mode 'training' in the whole product was a card on
     * the Deploy panel that sits below the fold of a scrollable column.
     *
     * So the tab gets the button its name promises, and it is the primary one:
     * a player being shot to pieces opens this tab looking for the tutorial,
     * which is exactly why _buildTraining puts the tab second. The sandbox
     * keeps its own button and its own honest label, one step down the
     * hierarchy. Both are four lines and both go through `selectMode`, so the
     * Deploy panel's Mode list is still telling the truth afterwards.
     */
    const lessons = document.getElementById('btn-lessons');
    if (lessons) lessons.addEventListener('click', () => {
      audio.ui('click');
      this.selectMode('training');
      this.hooks.onDeploy?.(this.s);
    });

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
      this._activate(d, () => {
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

    // …and the one beside it, through `_check` rather than by hand. The blade
    // ceiling above needs the `apply` side effect and so is wired here; this
    // one needs nothing but the setting, and going through the helper is what
    // puts it in the bound table that controls.mjs reads — a hand-wired box
    // has to be excused by name in PICKED, and an excuse is a thing that can
    // be granted to something that does not deserve one.
    this._check('opt-unlimited-focus', 'unlimitedFocus', () => audio.ui('click'));
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
      this._activate(d, () => {
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
   * HOW MUCH OF THE HOLOCRON IS OPEN. See DEFAULT_SETTINGS.holocron for why
   * the last two exist; the short version is that a power nobody can reach is
   * a power nobody can tell you is broken.
   *
   * Live-switchable like every other picker in this column, but it only bites
   * on the next deploy — the grant happens in `World.spawnPlayer`, which is a
   * thing that has already happened by the time a run is under way. The blurb
   * says so rather than the setting silently doing nothing.
   */
  _buildHolocronModes() {
    const host = document.getElementById('opt-holocron');
    if (!host) return;
    const modes = [
      ['earned', 'Earned',
       'The game. Insight is a run currency, you kneel to spend it, and nothing carries over.'],
      ['open', 'Open',
       'A full purse at every deploy. You still kneel, still choose, and prices still climb — you simply never run short.'],
      ['all', 'Everything lit',
       'Every facet already yours before the first wave. No choice at all: this is for looking at a power, not earning it.'],
    ];
    host.innerHTML = '';
    for (const [key, name, blurb] of modes) {
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.holocron === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}</span></div>`;
      this._activate(d, () => {
        audio.ui('click');
        this.s.holocron = key;
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
      });
      host.appendChild(d);
    }
  }

  /**
   * Key bindings. Clicking a key listens for the next keypress or mouse button
   * and takes it, warning if it is already spoken for. Escape cancels.
   */
  /**
   * THE KEY TABLE — and it is drawn wherever there is a host for it.
   *
   * "You should be able to change your key bindings mid game not just in the
   * main menu." The list was one `#bind-list` in the Options panel, which
   * behind a run means Abandon Run, rebind, deploy again — and a binding is
   * exactly the thing you discover is wrong in the first thirty seconds of a
   * fight.
   *
   * The fix is NOT a second copy of this method on the pause card. Everything
   * that makes the list correct is in here — the group map that stopped
   * headings rendering twice, the capture-phase listener that hears a mouse
   * button and a wheel notch, the resolver that settles every clash rather
   * than the first, the "never leave an action unbound" rule on right-click,
   * and the repaint of every other surface that prints a key. A second copy
   * would be a second place for all nine of those to go stale. So `render()`
   * paints every host in HOSTS that exists on the page, and the pause card is
   * just another host.
   *
   * Both lists stay live at once: they read `this.bindings`, one object, so a
   * key rebound on the pause card is already rebound in Options when the run
   * ends. `_listening` is the one piece of state that must be global to the
   * pair — two chips waiting for the same keystroke is two rebinds from one
   * press — and it always was.
   */
  _buildBindings() {
    const HOSTS = ['bind-list', 'pause-bind-list'];
    const hosts = HOSTS.map(id => document.getElementById(id)).filter(Boolean);
    if (!hosts.length) return;
    this.bindings = this.bindings || loadBindings();
    const hint = document.getElementById('bind-hint');

    /**
     * GROUPED BEFORE IT IS DRAWN, NOT WHILE IT IS DRAWN.
     *
     * This used to emit a heading whenever `a.group` differed from the last row
     * — which is a heading per RUN of a group, not per group, and ACTIONS is
     * not sorted by group. `swap` ("Drop / take a saber") was appended to
     * Bindings.js after the Force block with `group: 'Blade'`, so the list read
     * MOVEMENT, BLADE (10 rows), FORCE (12 rows), BLADE (1 row), INTERFACE,
     * TRAINING. `.bindlist` is a 330 px scroller, so the two BLADE headings
     * were almost never on screen together: a player looking for the drop key
     * under the first one simply concluded it was not rebindable.
     *
     * Building the map first means a group is a group wherever its rows were
     * declared, and the next row appended to the wrong end of that table lands
     * under the right heading instead of minting a second one. Order is first
     * appearance, so the list still reads Movement, Blade, Force, Interface,
     * Training the way the table intends.
     */
    const render = () => {
      const grouped = new Map();
      for (const a of ACTIONS) {
        if (!grouped.has(a.group)) grouped.set(a.group, []);
        grouped.get(a.group).push(a);
      }
      for (const host of hosts) {
      host.innerHTML = '';
      for (const [group, rows] of grouped) {
        const g = document.createElement('div');
        g.className = 'grp'; g.textContent = group;
        host.appendChild(g);
        for (const a of rows) {
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
            // A key chip is a control, so it takes focus and answers Enter and
            // Space — rebinding the keyboard was itself mouse-only.
            this._activate(b, () => listen(a, i, b), `rebind ${a.label}`);
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
      }
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

    // Both reset buttons, for the same reason both lists exist: a player who
    // has rebound something mid-fight and wants it back should not have to
    // leave the run to get it.
    for (const id of ['btn-bind-reset', 'btn-pause-bind-reset']) {
      const reset = document.getElementById(id);
      if (!reset || reset._wired) continue;
      reset._wired = true;
      reset.addEventListener('click', () => {
        audio.ui('click');
        this.bindings = defaultBindings();
        saveBindings(this.bindings);
        this.hooks.onBindings?.(this.bindings);
        render();
      });
    }
    /**
     * THE PAUSE CARD'S LIST IS FOLDED AWAY UNTIL IT IS ASKED FOR.
     *
     * `.pause-wrap` is a 400 px card with five buttons on it, and forty rows
     * of key table dropped into that is a card you have to scroll past to
     * reach Resume. So the pause copy is a disclosure: one button that says
     * what is behind it, and the list underneath when it is open. It starts
     * closed on every pause — a card that remembers being open is a card that
     * hides Resume behind a list you opened once, twenty minutes ago.
     */
    const toggle = document.getElementById('btn-pause-bind');
    const box = document.getElementById('pause-bind-box');
    if (toggle && box && !toggle._wired) {
      toggle._wired = true;
      toggle.addEventListener('click', () => {
        audio.ui('click');
        const open = box.classList.toggle('hidden');
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
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

  /** Which track is really playing, and why it may not be the chosen one. */
  _syncTrackBlurb() {
    const el = document.getElementById('music-blurb');
    if (!el) return;
    const t = trackAt(this.s.musicIndex);
    el.textContent = this._musicMissing
      ? `${this._musicMissing} is not in this build — playing ${trackAt(audio.musicIndex).name}. `
        + 'Drop the file into assets/music/ and it is an option.'
      : t.blurb;
  }

  /**
   * SYNTHESISED / SPOKEN / BOTH.
   *
   * Three cards rather than a checkbox because there are three answers and one
   * of them is the game as it stands. The cards say what each costs a player:
   * the synthesiser is wordless on purpose, the browser's speech is real words
   * and sounds like the browser, and 'both' is the pair together for anyone
   * who wants the alien cadence AND to know what was said.
   *
   * The third card is disabled outright where the browser has no synthesiser,
   * rather than being offered and silently doing nothing — the dead-control
   * shape this whole front end has a check against.
   */
  _buildSpeechModes() {
    const host = document.getElementById('opt-speech');
    if (!host) return;
    const able = canSpeakWords();
    const modes = [
      ['synth', 'Synthesised', 'Wordless, and built from an oscillator and two formant filters at the '
        + 'moment it is needed. Five larynxes, no recordings, nothing to download.'],
      ['spoken', 'Spoken', 'The same lines in actual words, through your browser\'s own speech '
        + 'synthesiser. Your chosen voice sets the pitch and the pace.'],
      ['both', 'Both', 'The words over the larynx. Twice the voice, and it is a lot.'],
    ];
    host.innerHTML = '';
    for (const [key, name, blurb] of modes) {
      const d = document.createElement('div');
      const dead = key !== 'synth' && !able;
      d.className = 'diff' + (this.s.speechMode === key ? ' sel' : '') + (dead ? ' overruled' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}`
        + `${dead ? '<br><b>This browser has no speech synthesiser.</b>' : ''}</span></div>`;
      if (dead) { d.setAttribute('aria-disabled', 'true'); host.appendChild(d); continue; }
      this._activate(d, () => {
        audio.ui('click');
        this._pick('speechMode', key);
        [...host.children].forEach(c => c.classList.toggle('sel', c === d));
        audio.setSpeechMode(key);
      });
      host.appendChild(d);
    }
    audio.setSpeechMode(this.s.speechMode);
  }

  /**
   * Write a PICKED setting by name, and save.
   *
   * The pickers each did this inline — `this.s.x = k; saveSettings(this.s)` —
   * which is fine until a picker forgets the save, and tools/checks/controls.mjs
   * matches the assignment by name to prove a picked setting really has a
   * control. One helper keeps both true.
   */
  _pick(key, value) {
    this.s[key] = value;
    saveSettings(this.s);
    return value;
  }

  _buildOptions() {
    /* FOUR of these sliders index a TABLE, and the tables can grow. Their
     * `max` is taken from the table rather than typed into index.html, so
     * adding a sixth voice, an eighth reticle shape or a second soundtrack
     * cannot leave the new one unreachable behind a stale attribute.
     *
     * Declared at the top of the method rather than beside the voice block it
     * was written for: the soundtrack slider is built with the rest of the
     * audio controls, forty lines earlier, and a `const` used above its own
     * declaration is a TDZ throw that takes the whole front end down — which
     * is exactly what it did, on every check in tools/checks/menu.mjs at once.
     */
    const cap = (id, n) => { const el = document.getElementById(id); if (el) el.max = String(n - 1); };
    this._buildDeflectModes();
    this._buildHolocronModes();
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
      this._activate(d, () => {
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
      // The tier states what it REMOVES as well as what it spends: `bloom` is
      // the one column of QUALITY that the tier can switch off under a control
      // the player also owns, and the Performance card said nothing about it
      // while silently overruling the Bloom checkbox.
      const budget = `${Math.round(q.particles * 100)}% particles · ${Math.round(q.grass * 100)}% grass `
        + `· ${q.viewDist} m view · ${q.shadow}px shadows${q.bloom ? '' : ' · no bloom'}`;
      const d = document.createElement('div');
      d.className = 'diff' + (this.s.quality === key ? ' sel' : '');
      d.innerHTML = `<i class="dot"></i><div class="txt"><b>${name}</b><span>${blurb}<br>${budget}</span></div>`;
      this._activate(d, () => {
        audio.ui('click');
        this.s.quality = key;
        [...qhost.children].forEach(c => c.classList.toggle('sel', c === d));
        saveSettings(this.s);
        // A tier change can take the bloom pass away or give it back, so the
        // checkbox has to be re-stated in the same frame the tier is picked.
        this._syncBloomBox();
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
    /**
     * THE FOUR THAT HAD A READER AND NO CONTROL.
     *
     * `teamDamage` (note #29, asked for by name), `commandFormation`,
     * `instantSpawn` and `maxBodies` were all read by shipped code and written
     * by nothing — not a slider, not a box, not a card. All four slipped past
     * BOTH dead-control checks for the same reason: those iterate
     * `Object.keys(DEFAULT_SETTINGS)`, and none of the four was a key of it. A
     * guard keyed on the list of things you remembered to declare cannot find
     * the thing you forgot to declare. The guard now scans src/ for what is
     * actually read, and that is what turned these up.
     *
     * None of them takes effect through a hook: `commandConfig`, `instantSpawn`
     * and the physics constructor all read `world.settings` at the moment they
     * need it, so the value written here is the value the next area, the next
     * arrival and the next world get.
     */
    this._slider('opt-teamdamage', 'teamDamage',
      v => (v <= 0 ? 'none' : `${Math.round(v * 100)}%`));
    this._slider('opt-maxbodies', 'maxBodies', v => `${Math.round(v)} pieces`);
    this._check('opt-instant-spawn', 'instantSpawn');
    /* The meeting. Read by `commandConfig` at world build, like the two above,
     * so the value written here is the one the next deployment gets. */
    this._check('opt-command-versus', 'commandVersus');
    /* The standing order, as six cards — the formation records ARE the card
     * list (id, name, blurb), so the row cannot fall out of step with the
     * orders on the keyboard or with what the director will actually do. */
    this._cardRow('command-list', 'h-standing-order', 'commandFormation', Object.values(FORMATIONS));
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
    /*
     * THE SCORE ITSELF, on the same shape as the voice picker: a slider that
     * prints a NAME. The ceiling comes off MUSIC_TRACKS rather than out of the
     * markup, so dropping an mp3 into assets/music/ and adding a row is the
     * whole of adding a track — a `max` typed into index.html would leave the
     * new one unreachable behind a stale attribute.
     */
    cap('opt-music-track', MUSIC_TRACKS.length);
    this._slider('opt-music-track', 'musicIndex', v => trackAt(v).name, (v) => {
      audio.setMusicTrack(v);
      this._syncTrackBlurb();
    });
    /*
     * …and the engine reports back. A row may name a file that is not in the
     * build — that is what a data-driven list costs — so the one thing the
     * screen must never do is offer it, play nothing and say nothing. Audio
     * falls back to the shipped score and calls this; the blurb says which
     * track is really playing.
     */
    audio.onMusicMissing = (t) => {
      this._musicMissing = t?.name || null;
      this._set('musicIndex', audio.musicIndex, true);
      this._syncTrackBlurb();
    };
    this._syncTrackBlurb();
    this._check('opt-invert', 'invertY', v => this.hooks.onInvert?.(v));
    this._check('opt-firstperson', 'firstPerson');
    // Live on the same seam as shake and slowmo: applyFeelSettings pushes it
    // onto every player's controller, so it bites on the next frame instead of
    // on the next deploy.
    this._check('opt-bladehold', 'bladeHold', () => this.hooks.onFeel?.(this.s));
    this._check('opt-bloom', 'bloom', v => this.hooks.onBloom?.(v));
    this._syncBloomBox();
    this._check('opt-showperf', 'showPerf', () => this._syncDiag());
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
    this._buildSpeechModes();
    this._check('opt-voicelines', 'voiceLines');
    this._check('opt-enemyvoices', 'enemyVoices');
    this._check('opt-enemybody', 'enemyBody');
    this._check('opt-popups', 'popups');
    // No hook: the map asks `world.settings` on the frame it draws, and that is
    // the same object this menu is writing. A hook here would be a message to a
    // system that is already reading the answer.
    this._check('opt-minimap', 'minimap');
    // Same shape and the same reason as the box above it: HUD.Minimap asks
    // `world.settings` on the frame it draws, and that is this object.
    this._check('opt-minimap-sense', 'minimapSense');
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
    audio.init();
    audio.resume();
    audio.setVoiceLevel(this.s.voiceLevel);
    /**
     * `audition`, NOT `speak` behind an `if (audio.speaking > 0) return`.
     *
     * Dragging the slider walks every archetype on the way past, and the guard
     * that used to be here dropped every line after the first — so the slider
     * auditioned whatever voice you happened to DRAG THROUGH and stayed silent
     * on the one you released on. Measured on a five-step drag: it spoke the
     * negotiator and never spoke the sage the player actually chose.
     *
     * `AudioEngine.audition` is leading edge plus a 180 ms trailing edge: a
     * click answers at once, and a drag answers again with the LAST index,
     * fading out whatever the drag left running so the chosen line is not
     * ducked underneath it. The "Hear it" button is unaffected — a call more
     * than 180 ms after the previous one speaks immediately.
     */
    audio.audition(voiceAt(index), 'streak', { gain: 1, self: true });
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
    /**
     * THE NAME, WHICH FOUR PLAYERS USED TO SHARE.
     *
     * `net.name` had exactly one value in the whole codebase: the constructor
     * default `'Jedi'` (Net.js:56). Its only writers were Net.host and Net.join
     * and both call sites passed `net.name` straight back to itself, and there
     * was no field anywhere to type one into — so a four-player session listed
     * 'Jedi', 'Jedi', 'Jedi', 'Jedi', the status line said 'Jedi joined', every
     * nameplate over every ally said 'Jedi', and the kill feed said 'Jedi cut
     * down a B1' whoever had done it. A roster whose whole job is telling
     * players apart cannot be a constant.
     *
     * It is a setting rather than a field on Net so it survives a reload, and
     * it is capped at 18 characters because it is drawn over a head in the
     * world and inside a roster row 340 px wide.
     */
    const nameField = document.getElementById('opt-name');
    if (nameField) {
      nameField.value = this.s.playerName || '';
      nameField.addEventListener('input', () => {
        this.s.playerName = String(nameField.value || '').slice(0, 18);
        if (nameField.value !== this.s.playerName) nameField.value = this.s.playerName;
        saveSettings(this.s);
        this.hooks.onName?.(this.s.playerName);
      });
    }
    bind('btn-host', () => this.hooks.onHost?.());
    bind('btn-join', () => {
      const code = document.getElementById('join-code').value.trim().toUpperCase();
      if (code) this.hooks.onJoin?.(code);
    });
    bind('btn-leave', () => this.hooks.onLeave?.());
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

  /**
   * WHAT THE SESSION CONTROLS SAY ABOUT THE SESSION YOU ARE IN.
   *
   * Two buttons that were wrong in opposite directions. There was no way to
   * LEAVE: `quitToMenu()` closes the session, but a player who has connected
   * and not deployed has no run to quit, so the only exit was to start one and
   * abandon it. And Restart was offered to a co-op client, where
   * `World.restartWave()` refuses because only the host owns the wave —
   * a button that answers "no" is a worse answer than no button.
   *
   * @param mode  null when solo, 'host' or 'client' in a session.
   */
  netSession(mode) {
    this.el.netLeave?.classList.toggle('hidden', !mode);
    this.el.restart?.classList.toggle('hidden', mode === 'client');
  }
  /**
   * The roster, with the names treated as what they are: text that arrived
   * over the wire from another machine (`conn.metadata?.name`, Net.js:148).
   * It used to be interpolated raw into innerHTML — harmless while nothing
   * could set a name, and a script tag in a roster row the moment one could.
   * The name goes in as a text node; only the markup around it is markup.
   */
  netRoster(players) {
    this.el.netRoster.innerHTML = '';
    for (const p of players) {
      const d = document.createElement('div');
      d.className = 'p';
      d.innerHTML = `<i></i><span></span>${p.host ? '<em style="margin-left:auto;color:#8b98ad">host</em>' : ''}`;
      const span = d.querySelector('span');
      if (span) span.textContent = p.name || 'Jedi';
      this.el.netRoster.appendChild(d);
    }
  }

  /* ── overlays ────────────────────────────────────────────────────── */

  /**
   * THE MID-RUN DRAFT, WHICH HAD TO BE ANSWERED WITH A MOUSE.
   *
   * This is the one modal in the game that STOPS THE WORLD and has no exit but
   * an answer: Escape opens the pause card, and Resume deliberately puts the
   * draft straight back (Screens.resume, rule 2 — skipping it would rob the
   * player of the boon the wave paid for). So with three `.dc` divs carrying
   * nothing but a click listener, a player without a working mouse mid-run had
   * exactly one way out of a wave they had already won, and it was Abandon run.
   *
   * Three things make it answerable: the cards are real controls (_activate),
   * the first one is FOCUSED as the draft opens so nobody has to hunt for the
   * focus ring, and the arrows walk the row while the number keys take a card
   * outright. The numbers are printed on the cards, because a shortcut nobody
   * is told about is not a shortcut.
   *
   * ── AND IT SAYS WHAT IT IS, WHY IT IS THERE, AND HOW TO ANSWER IT ───────
   *
   * The report: "once I pressed a button and saw a menu mid game where I
   * selected a power up but idk how it happened or what button I pressed."
   * They pressed nothing. This card opened itself, and it was headed
   * "Attune" — a word for a thing that happens on boss waves — over an
   * ordinary between-waves boon draft, with one line of copy that began "The
   * Force offers" and never mentioned that the wave they had just cleared is
   * what opened it. A modal that stops the world and does not say why is
   * indistinguishable from a bug the player caused.
   *
   * So three sentences are written here rather than in the markup, because
   * two of them differ per draft:
   *
   *   WHAT — an attunement is permanent, repeatable and only on a boss wave;
   *          a boon is one card off this wave. The `attune` flag on the offer
   *          is what says which, so the title follows the offer.
   *   WHY  — the cadence, READ from Waves.js (DRAFT_EVERY, BOSS_EVERY) rather
   *          than typed. Every number this front end has ever typed by hand
   *          has eventually described a game that stopped existing, and this
   *          one is load-bearing: it is the sentence that tells the player
   *          nothing they pressed did this.
   *   KEYS — the numbers, the arrows, Enter, and what Escape does. Escape is
   *          worth a clause of its own because it does NOT skip the offer:
   *          Screens.resume puts the draft straight back, deliberately, and a
   *          player who does not know that will not press it.
   */
  showDraft(boons, onPick) {
    const attune = boons.some(b => b.attune);
    const title = document.getElementById('draft-title');
    const why = document.getElementById('draft-why');
    const keys = document.getElementById('draft-keys');
    if (title) title.textContent = attune ? 'Attune' : 'The Force Offers';
    if (why) {
      why.innerHTML = attune
        ? '<b>A master has fallen.</b> This is an <b>attunement</b> — a permanent change to how you '
          + 'fight, and the only place the game hands one out is after a boss. It opened on its own: '
          + `you pressed nothing. Bosses arrive every ${BOSS_EVERY} waves.`
        : `<b>The wave is clear.</b> This is the <b>boon draft</b> — one card, taken now, that lasts `
          + `the rest of the run. It opened on its own every ${DRAFT_EVERY === 1 ? 'wave' : `${DRAFT_EVERY} waves`} `
          + 'and after every boss: you pressed nothing, and there is no key that opens it.';
      // Written as innerHTML for the <b>s, and the two sentences above are the
      // only strings on this card that are not either a boon's own text or a
      // number read out of Waves.js.
    }
    if (keys) {
      keys.innerHTML = `Click a card, press its <kbd>number</kbd>, or walk the row with the `
        + `<kbd>arrows</kbd> and take one with <kbd>Enter</kbd>. `
        + `<kbd>Esc</kbd> opens the pause card — the offer comes back when you resume, `
        + 'because the wave paid for it.';
    }
    this.el.draftCards.innerHTML = '';
    const cards = [];
    const take = (b) => {
      audio.ui('good');
      this.el.draft.classList.add('hidden');
      onPick(b);
    };
    boons.forEach((b, idx) => {
      const card = document.createElement('div');
      // An attunement is permanent and repeatable and a card is neither, so it
      // reads differently rather than hiding among them.
      card.className = b.attune ? 'dc att' : 'dc';
      card.innerHTML = `<div class="ic">${b.icon}</div><b>${b.name}</b><span>${b.text}</span>`
        + `<em>${b.tag}<kbd class="dck">${idx + 1}</kbd></em>`;
      card.addEventListener('mouseenter', () => audio.ui('hover'));
      this._activate(card, () => take(b), `${b.name} — ${b.text}`);
      card.addEventListener('keydown', (e) => {
        const i = cards.indexOf(card);
        const n = Number(e.key);
        if (n >= 1 && n <= boons.length) { e.preventDefault(); take(boons[n - 1]); return; }
        const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
          : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        cards[(i + step + cards.length) % cards.length]?.focus?.();
      });
      cards.push(card);
      this.el.draftCards.appendChild(card);
    });
    this.el.draft.classList.remove('hidden');
    // Focus lands on the offer, not on whatever the page was showing before it.
    cards[0]?.focus?.();
  }
  hideDraft() { this.el.draft.classList.add('hidden'); }

  /**
   * THE MUSTER — the screen that did not exist, and what its absence cost.
   *
   * `CommandDirector._areaClear` publishes an offer between every pair of
   * areas: your reinforcement points, the units this far into the advance will
   * sell you, what each costs, how many you already field, and the whole roll.
   * There was no screen, so main.js's `typeof screens.muster === 'function'`
   * found nothing, `onMuster` was never installed, and the director took the
   * documented fallback — `autoMuster()`, which replaces losses with the
   * cheapest body it can and then spends everything left on the heaviest thing
   * on the shelf. Correct behaviour for a mode with no UI, and it means the
   * player's army was rebuilt for them four times a campaign, by a heuristic,
   * with nothing on screen. Permadeath whose replacement budget you never see
   * is permadeath with the decision taken out of it.
   *
   * WHAT IS ON IT AND WHY IT IS TWO COLUMNS. The shelf on the left and the roll
   * on the right, in one glance, because the question at a muster is never
   * "what exists" — `musterOffer`'s own comment says so — it is "should this be
   * my third heavy or my first ARC", and that question cannot be asked without
   * the casualty list beside the price list.
   *
   * NOTHING HERE DECIDES ANYTHING. Every purchase goes through
   * `director.recruit`, which guards against every refusal case itself and puts
   * a reason on `director.refused`; this screen prints that reason and redraws
   * from a fresh `musterOffer()`. A screen that decremented its own copy of the
   * points would disagree with the director the first time it was refused, and
   * a muster whose numbers lie is worse than no muster.
   *
   * @param {object} offer `CommandDirector.musterOffer()`, verbatim.
   * @param {{recruit:(type:string)=>object, done:()=>void}} io  `recruit`
   *        returns `{ offer, refused }` — the director's new state and its
   *        reason for refusing, if it did.
   */
  showMuster(offer, io = {}) {
    const el = {
      root: document.getElementById('muster'),
      held: document.getElementById('muster-held'),
      title: document.getElementById('muster-title'),
      brief: document.getElementById('muster-brief'),
      units: document.getElementById('muster-units'),
      refused: document.getElementById('muster-refused'),
      rollHead: document.getElementById('muster-roll-head'),
      list: document.getElementById('muster-list'),
      points: document.getElementById('muster-points'),
      strength: document.getElementById('muster-strength'),
      done: document.getElementById('btn-muster-done'),
    };
    /* Returns whether the card actually went up. Screens.muster reads it: a
     * muster that cannot be drawn must not leave a campaign stopped on a state
     * whose overlay is not on the screen, and the caller's fallback is to
     * muster without one. */
    if (!el.root) return false;
    this._musterEl = el;
    /* The LIVE handlers, on the instance rather than in the listener's
     * closure. The Advance button is bound once — binding it per muster would
     * stack five listeners over a campaign and close the screen five times —
     * and a listener that closed over the FIRST offer's `io` would, on area
     * four, call area one's director callback. Same class of bug as the four
     * duplicate listeners this file already carries a note about. */
    this._musterIo = io;

    const draw = (o) => {
      if (!o) return;
      this._muster = o;
      // The area just HELD, and the one being walked into. Both are the
      // director's own strings — the brief that names the ground is what makes
      // the next four minutes legible, and it is already written.
      if (el.held) el.held.textContent = `${o.areaName} — held`;
      if (el.title) el.title.textContent = o.next ? o.next.name : 'The advance is over';
      if (el.brief) el.brief.textContent = o.next ? o.next.brief : '';
      if (el.points) el.points.textContent = String(o.points | 0);
      if (el.strength) el.strength.textContent = `${o.strength | 0}/${o.max | 0}`;
      if (el.rollHead) {
        const lost = (o.roster?.roll || []).filter(t => !t.alive).length;
        el.rollHead.textContent = lost ? `The roll — ${lost} lost` : 'The roll';
      }
      if (el.list) el.list.innerHTML = rosterHtml(o.roster);

      if (el.units) {
        el.units.innerHTML = '';
        for (const u of o.units || []) {
          const card = document.createElement('div');
          // Priced out rather than removed: what you cannot afford is the shape
          // of the decision, and a shelf that empties itself says nothing about
          // what you are saving up for.
          card.className = u.afford ? 'mu' : 'mu poor';
          card.innerHTML = `<b>${escKey(u.label)}</b>`
            + `<span class="cost">${u.cost} points · threat ${u.threat}</span>`
            + `<span class="have">You field ${u.have}</span>`;
          if (u.afford) {
            card.addEventListener('mouseenter', () => audio.ui('hover'));
            this._activate(card, () => buy(u.type), `${u.label} — ${u.cost} points`);
          }
          el.units.appendChild(card);
        }
      }
    };

    const buy = (type) => {
      const res = this._musterIo?.recruit?.(type);
      if (el.refused) el.refused.textContent = res?.refused || '';
      audio.ui(res?.refused ? 'bad' : 'click');
      draw(res?.offer || this._muster);
    };

    if (el.refused) el.refused.textContent = '';
    draw(offer);

    if (el.done && !el.done.dataset.musterBound) {
      el.done.dataset.musterBound = '1';
      // The card hides itself BEFORE the callback, exactly as the draft does,
      // which is the reason Screens.guarded exists — a throw inside `done`
      // lands the player on the pause card instead of on a frozen field.
      this._activate(el.done, () => {
        audio.ui('good');
        this.hideMuster();
        this._musterIo?.done?.();
      });
    }
    el.root.classList.remove('hidden');
    el.done?.focus?.();
    return true;
  }

  hideMuster() { document.getElementById('muster')?.classList.add('hidden'); }

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
    // The fallback names a MODE, never a level. It used to say `level ===
    // 'dojo'`, and the dojo has since been deleted — so the second half of this
    // test had quietly become a constant `false`, and a player who paused in
    // training with no live director to ask lost the sliders entirely.
    const live = sandboxLive !== undefined
      ? !!sandboxLive
      : (this.s.mode === 'sandbox' || this.s.mode === 'training');
    const box = this._buildPauseTraining();
    if (box) {
      box.style.display = live ? '' : 'none';
      if (this._pauseType) this._pauseType.value = sandboxConfig(this.s).type;
    }
    // The key table folds itself away between pauses — see _buildBindings.
    const binds = document.getElementById('pause-bind-box');
    const toggle = document.getElementById('btn-pause-bind');
    if (binds) binds.classList.add('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    this.el.pause.classList.remove('hidden');
  }
  hidePause() { this.el.pause.classList.add('hidden'); }

  /**
   * The death card. `title` is TOTAL, not optional.
   *
   * It used to be `if (title) …`, and the card is shared DOM written on two
   * paths: `gameOver()` passes nothing, `crowned()` passes "You stand above
   * the storm". So finishing the Descent once left that line in the element
   * for the rest of the session — every subsequent death, in any mode, was
   * announced with the crown's congratulation printed over the stats of a run
   * the player had just lost. The seed used to live in index.html, which is
   * why nothing here felt responsible for putting it back.
   */
  showDeath(stats, title) {
    this.el.deathTitle.textContent = title || DEATH_TITLE;
    this.el.deathStats.innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.el.death.classList.remove('hidden');
  }
  hideDeath() { this.el.death.classList.add('hidden'); }

}
