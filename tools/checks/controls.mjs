/**
 * BATTLEFRONT BORZ — the controls tell the truth.
 *
 * An audit for "reads correctly, silently wrong" found four of these in the
 * menu and the key table, and every one of them read perfectly well as source:
 *
 *   1. "Camera shake" was a default in DEFAULT_SETTINGS bound to a checkbox
 *      with no onChange, and no consumer anywhere in src/. Unticking it changed
 *      nothing.
 *   2. "Cinematic slow-motion" was the same: a default, a checkbox, no reader.
 *   3. "Cleaving Throw" set `p.boonMods.throwPierce = true` and nothing read
 *      the flag. The card promised a blade that passes through everything and
 *      returns faster; the throw behaved exactly as it did without the boon.
 *   4. `scoreboard` was in ACTIONS, bound to Tab, printed in the Codex and on
 *      the pause card, and handled by nobody. The only Tab in main.js was a
 *      preventDefault, which is what made it look wired.
 *
 * So the checks come in two kinds. The behavioural ones drive the real code —
 * a real CameraRig, World.prototype.update, Player.prototype._updateThrow —
 * and print the number the claim rests on, on and off. The structural ones make
 * the whole class of bug fail the build: a setting with no reader, a boon whose
 * only effect is a flag nobody reads, an action nothing handles.
 */

import * as THREE from 'three';
import { readFile, readdir } from 'node:fs/promises';
import { CameraRig } from '../../src/game/Player.js';
import { World } from '../../src/game/World.js';
import { FocusSystem } from '../../src/game/Focus.js';
import { ArmyIndex } from '../../src/game/ArmyIndex.js';
import { BladeContactSolver, TOUGHNESS } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';
import { Player } from '../../src/game/Player.js';
import { TokenPool } from '../../src/game/Tokens.js';
import { DEFAULT_SETTINGS, SETTING_READERS, applyFeelSettings, CODEX, SCHEMES, codexHtml, pauseHintsHtml,
  keyChips } from '../../src/ui/Menu.js';
import { BOONS, CLEAVE, cleavingThrow } from '../../src/game/Waves.js';
import { ACTIONS, ACTION_IDS, MOUSE, defaultBindings, conflicts, findConflict, findConflicts,
  resolveConflicts, loadBindings, saveBindings, settleBindings, keyLabel, ORDER_ACTIONS, ORDER_GROUP, orderActionId,
  registerOrders, PAD, PAD_CODES, PAD_AXES, PAD_AXIS_CODES, PAD_MODIFIERS, PAD_FAMILY,
  isPadCode, isChord, chordParts, codesFor, padFamily, padLabel } from '../../src/engine/Bindings.js';
// The authority for what an order IS. Imported here so the check can re-derive
// the six rows from the same place Menu.js derives them, and disagree.
import { FORMATIONS, FORMATION_IDS } from '../../src/game/Command.js';
import { Input } from '../../src/engine/Input.js';
import { SaberController } from '../../src/game/SaberController.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { Particles } from '../../src/world/Particles.js';
import { GrassField } from '../../src/world/Scenery.js';
import { Terrain } from '../../src/world/Terrain.js';
import { DojoDirector } from '../../src/game/Dojo.js';
import { clocked, modsMoved } from './_shared.mjs';

/**
 * Where every COLUMN of Engine's QUALITY table is actually read.
 *
 * Same instrument as SETTING_READERS and for the same reason, one level down.
 * `grass` (0.25→1.5) and `particles` (0.4→1.35) sat in that table from the
 * foundation commit with no reader anywhere in src/ — `git log -S"q.particles"`
 * was empty — while World.loadLevel kept its own inline
 * `{low:0.55, medium:0.8, high:1, ultra:1.25}` and the Performance card
 * promised "fewer particles… for laptops and integrated graphics". Every tier
 * got Cinematic's budget. `bloom` was a third: true on all four rows and read
 * by nobody.
 *
 * A tier is a PROMISE about what the machine will be asked to draw. A column
 * of that promise with no reader is the same lie as a checkbox with no
 * onChange, so it fails the build the same way.
 *
 * This lives here rather than beside QUALITY only because Engine.js belongs to
 * another lane this round; it wants to move next to the table it describes.
 */
const QUALITY_READERS = {
  shadow:     ['engine/Engine.js', 'L.shadow.mapSize.set(q.shadow, q.shadow)'],
  shadowDist: ['engine/Engine.js', 'q.shadowDist * f'],
  viewDist:   ['engine/Engine.js', 'this.camera.far = q.viewDist'],
  pixelRatio: ['engine/Engine.js', 'Math.min(window.devicePixelRatio, q.pixelRatio)'],
  /* Was `samples: q.msaa`, which was the CONSTRUCTOR's read and the only one
   * there was — the composer's sample count could not be assigned, so the tier
   * the player chose mid-run never reached it. Now that `setQuality` rebuilds
   * the target, the read that matters is the one inside it; this names the
   * construction site, and `frame-budget` holds the live path. */
  msaa:       ['engine/Engine.js', 'QUALITY[this.quality].msaa'],
  bloom:      ['main.js', 'QUALITY.high).bloom'],
  grass:      ['game/World.js', 'Math.round(11000 * q.grass)'],
  particles:  ['game/World.js', 'q.particles'],
  // The outline prepass's resolution, as a fraction of the frame. It is read in
  // two places on purpose — once when the pass is built and once when the tier
  // changes under a running composer — and the second one is what the column
  // actually promises, so it is the one named here.
  ink:        ['engine/Engine.js', 'this.outline.scale = q.ink'],
  // How far an ENEMY may be and still solve its garments, in metres. It rode on
  // Enemy's own `lod > 1` before, which is 62 m — above the 60 m the farthest
  // level ever spawns anything at — so the most expensive thing a character
  // owns had no working switch at all. See the note over QUALITY.cloth.
  cloth:      ['game/World.js', 'this.clothCut = q.cloth'],
};

const DEG = 180 / Math.PI;
const scene = new THREE.Scene();
const src = (p) => new URL('../../src/' + p, import.meta.url);
const read = async (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/* ── a camera rig driven the way the game drives it ──────────────────── */

/**
 * `frames` frames of a third-person rig following a walking body, with a
 * grenade going off every `every` frames. Returns the view direction and the
 * eye position on each frame, which is everything a deviation is measured from.
 */
/**
 * @param opts.seconds  how long to drive, in GAME time
 * @param opts.dt       the frame length; the schedule below is in seconds, so
 *                      two runs at different dt cover the same four seconds and
 *                      are directly comparable. That is not decoration: it is
 *                      how `the shake runs on the game's clock` is measured.
 * @param opts.every    seconds between kicks
 */
function driveRig(settings, { seconds = 4, dt = 1 / 60, every = 0.5, kick = 1.5 } = {}) {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 400);
  const rig = new CameraRig(cam);
  rig.shakeSeed = 12.5;                 // same phase in every run, so runs compare
  // The gate goes on exactly what the game gates: a world whose player owns
  // this rig. applyFeelSettings is the code main.js calls in buildWorld.
  const world = { player: { camera: rig }, hitstop: 0, addHitstop() {} };
  if (settings) applyFeelSettings(world, settings);

  const target = new THREE.Vector3(0, 0, 0);
  const dirs = [], eyes = [], ts = [];
  const dir = new THREE.Vector3();
  const frames = Math.round(seconds / dt);
  let next = 0;
  for (let i = 0; i < frames; i++) {
    const t = i * dt;
    if (t >= next - 1e-9) { rig.addShake(kick); next += every; }
    target.z -= 3.2 * dt;               // a body walking away at 3.2 m/s
    rig.update(dt, target, {});
    dirs.push(dir.set(0, 0, -1).applyQuaternion(cam.quaternion).clone());
    eyes.push(cam.position.clone());
    ts.push(t);
  }
  return { rig, dirs, eyes, ts };
}

/* ── a world clock with nothing in it but the clock ──────────────────── */

/**
 * World.prototype.update against a hand-made frame.
 *
 * Building a real World needs an Engine and a GPU; calling its own update
 * against stubs does not, and it is the SAME arithmetic — which is the point,
 * because the hitstop and the time scale are four lines at the top of that
 * function and nothing else in the codebase reproduces them.
 */
function clockWorld(settings) {
  const w = {
    running: true, paused: false, netMode: null,
    hitstop: 0, timeScale: 1, targetTimeScale: 1, time: 0, combatIntensity: 0, score: 0,
    focus: new FocusSystem(),
    settings, difficulty: null,
    player: null, players: [], enemies: [], props: [], doors: [], debris: [], locks: [],
    bladeSolver: new BladeContactSolver(), _targets: [], _capsCache: [],
    physics: { step() {}, bodies: [] },
    terrain: { flush() {} },
    particles: { update() {} },
    bolts: { update() {}, threatsNear: () => [] },
    director: { update() {} },
    /* THE REAL POOL, not a stub with an empty `update`. It is eleven lines of
     * bookkeeping over an empty roster here and it costs this fixture nothing,
     * and a fake one would mean this file quietly stopped stepping a subsystem
     * that `World.update` steps — which is how a hand-built world drifts from
     * the world it is borrowing `update` from. `World.update` calls it
     * unguarded, on purpose: a real World always has one. */
    tokens: new TokenPool(),
    /* THE BODY BROAD PHASE, and a real one for the same reason `tokens` is real
     * one line up: `World.update` syncs it unguarded because a real World always
     * has one, and a stub with an empty `sync` would mean this file quietly
     * stopped stepping a subsystem the world it borrows `update` from steps.
     * Over an empty enemy list it is one `Map.clear` a frame. */
    armyIndex: new ArmyIndex(),
    engine: {
      camera: new THREE.PerspectiveCamera(), sun: { color: 0 }, hemi: { color: 0 },
      fitShadows() {}, setRadial() {}, setFocus() {}, flash() {},
    },
    pickTarget() {}, pickSpawn() {}, spawnEnemy() {},
    update: World.prototype.update,
    addHitstop: World.prototype.addHitstop,
    setTimeScale: World.prototype.setTimeScale,
    _updateCatch: World.prototype._updateCatch,
    _resolveBlades: World.prototype._resolveBlades,
    _bladeEntries: World.prototype._bladeEntries,
    // `_bladeEntries` reaches `this._screenFor` for every lit blade — borrow
    // the one and you have borrowed the other. See pvp.mjs's note.
    _screenFor: World.prototype._screenFor,
    /* The extraction key's hold timer. `World.update` counts it off every
     * frame, so a world that borrows `update` has to carry it or the frame
     * throws — and a stub that answered `canWithdraw` true would call a ship
     * in the middle of a timing trace. `canWithdraw` is false here because
     * there is no player, which is the honest reason and not a switch. */
    _withdrawTick: World.prototype._withdrawTick,
    withdrawHold: 0,
  };
  applyFeelSettings(w, settings);
  return w;
}

/** Per-frame world-clock advance divided by real time, for `frames` frames. */
function timeScaleTrace(w, frames, dt = 1 / 60) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const before = w.time;
    w.update(dt, null);
    out.push((w.time - before) / dt);
  }
  return out;
}

/* ── a player who can throw ──────────────────────────────────────────── */

/** A body with a real Saber and the real throw, and nothing else it needs. */
function thrower(worldStub) {
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  saber.ignite(); saber.ignition = 1;
  const p = Object.assign(Object.create(Player.prototype), {
    world: worldStub, saber,
    aimDir: new THREE.Vector3(0, 0, -1),
    throwPos: new THREE.Vector3(), throwVel: new THREE.Vector3(),
    throwSpin: 0, throwTimer: 0, throwState: 'held',
    control: { handPos: new THREE.Vector3(0, 1.35, 0), quat: new THREE.Quaternion() },
    cooldowns: { throw: 0 }, force: 100,
    boonMods: {
      deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lifesteal: 0,
      lightning: false, repulse: false, throwPierce: false, doubleJump: false,
    },
    limbsRemoved: 0, score: 0, combo: 0, comboTimer: 0, flow: 0,
    camera: { addShake() {} }, addFlow() {}, heal() {},
  });
  return p;
}

/**
 * A line of bodies standing in the flight path, as capsules.
 *
 * Mixed on purpose: droid plating parts under a blade that barely touches it,
 * armour and heavy do not. That mix is the whole question the boon answers —
 * a thrown blade is never LEANT on anything, so anything the solver makes you
 * earn is something a stock throw cannot take.
 */
function targetsWorld(count, spacing = 4, cuts = [], toughness = null) {
  const bodies = [];
  for (let i = 0; i < count; i++) {
    const z = -(6 + i * spacing);
    const tough = toughness ? toughness[i % toughness.length] : TOUGHNESS.droid;
    bodies.push({
      id: 'e' + i, dead: false, type: 'b1', tough,
      capsules: () => [
        { name: 'chest', p0: new THREE.Vector3(0, 1.05, z), p1: new THREE.Vector3(0, 1.55, z), r: 0.26, toughness: tough, vital: 0.9 },
        { name: 'thighL', p0: new THREE.Vector3(-0.16, 0.45, z), p1: new THREE.Vector3(-0.16, 0.95, z), r: 0.12, toughness: tough, vital: 0.4 },
      ],
      takeCut(ev) { cuts.push({ id: this.id, bone: ev.bone, cutT: ev.cutT }); },
    });
  }
  return {
    enemies: bodies, props: [], particles: {}, hitstop: 0,
    addHitstop() {}, onHitmark() {},
    _applyBladeEvent(player, ev) { cuts.push({ id: ev.target.id, bone: ev.bone, cutT: ev.cutT, speed: ev.speed }); },
  };
}

/** The bodies as the blade solver wants them, rebuilt each frame. */
/**
 * CODES NOTHING IS BOUND TO — for every fixture that needs a key to rebind ONTO.
 *
 * Two fixtures below wrote `[...'A'..'Z'].find(unbound)` and got `undefined`
 * the day the table took the last free letter (KeyK, to `authorise`). An
 * undefined key does not throw: it is saved into a blob, loaded back, compared
 * against the key the player "chose", and the check fails claiming the
 * rebinder threw a deliberate rebind away — a red about the code, caused by
 * the fixture running out of keyboard.
 *
 * Same three tiers `spares()` inside the settling check already uses, and for
 * the same reason: letters first so a failure message still reads like a
 * keyboard, then the digits, then F13–F24, which is where the room actually
 * is. A caller that cannot get what it asked for is told so by name.
 */
function freeCodes(n = 1) {
  const used = new Set(Object.values(defaultBindings()).flat());
  const pool = [
    ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => `Key${c}`),
    ...[...'0123456789'].map(d => `Digit${d}`),
    ...Array.from({ length: 12 }, (_, i) => `F${13 + i}`),
  ];
  const free = pool.filter(c => !used.has(c)).slice(0, n);
  if (free.length < n) {
    throw new Error(`the bindings table has no ${n} unbound codes left in the letters, the digits `
      + 'or F13-F24 — this fixture needs one to rebind onto');
  }
  return free;
}

function solverTargets(w) {
  return w.enemies.filter(e => !e.dead).map(e => ({ id: e.id, capsules: e.capsules(), enemy: e, dead: false }));
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. Camera shake                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: unticking Camera shake actually stops the camera shaking', () => {
    // The reference: the same rig, same walk, never kicked at all. Anything the
    // shaken runs deviate from it BY is the shake, and nothing else.
    const still = driveRig(null, { kick: 0 });
    const on = driveRig({ ...DEFAULT_SETTINGS, shake: true });
    const off = driveRig({ ...DEFAULT_SETTINGS, shake: false });

    const peakAngle = (r) => {
      let worst = 0;
      for (let i = 0; i < r.dirs.length; i++) {
        worst = Math.max(worst, Math.acos(Math.min(1, r.dirs[i].dot(still.dirs[i]))) * DEG);
      }
      return worst;
    };
    const peakShift = (r) => {
      let worst = 0;
      for (let i = 0; i < r.eyes.length; i++) worst = Math.max(worst, r.eyes[i].distanceTo(still.eyes[i]));
      return worst;
    };

    const aOn = peakAngle(on), aOff = peakAngle(off);
    assert(aOn > 0.25, `shake ON only moved the view ${aOn.toFixed(3)}° — there is no shake to switch off`);
    assert(aOff === 0, `shake OFF still deviated ${aOff.toFixed(4)}° from a camera that was never kicked`);
    assert(peakShift(off) === 0, `shake OFF still moved the eye ${peakShift(off).toFixed(4)} m`);
    assert(off.rig.shake === 0, `the rig is holding ${off.rig.shake} of shake with the setting off`);
    // and the gate is on the funnel, not on the frame: nothing accumulates
    off.rig.addShake(1.5);
    assert(off.rig.shake === 0, 'addShake got through the gate');
    return `peak view deviation: ON ${aOn.toFixed(2)}° / ${peakShift(on).toFixed(3)} m, `
      + `OFF ${aOff.toFixed(4)}° / ${peakShift(off).toFixed(4)} m`;
  });

  check('controls: with camera shake off you still come out of your own head', () => {
    /**
     * A FIRST-PERSON DEATH WITH ONE CHECKBOX UNTICKED LEFT THE LENS INSIDE THE
     * CORPSE.
     *
     * The one line that gets the camera out of the head on death —
     * `this.firstPerson = false` — lived INSIDE `if (shot)` in `CameraRig.update`,
     * and `die()` only called `beginDeathShot` when `feelOn('shake') !== false`.
     * So a player who had turned camera shake off — an ordinary comfort
     * setting, and one this file already holds two other checks about —
     * watched their whole death from behind their own eyes: measured with
     * shake off, shot NONE, `firstPerson` still true, the lens 1.02 m from the
     * ragdoll's middle, boomless, for the entire death.
     *
     * The rule the neighbouring check states for the letterbox and the drain is
     * the rule here: `shake` governs MOTION. Whether the camera is inside the
     * body is not motion, it is whether there is a shot at all, and the death
     * camera is now always taken with only its script behind the toggle.
     *
     * Driven through a real Player dying in a stub world rather than by
     * reading the source, because "where is the lens" is a claim about a
     * position — and asserted in BOTH toggle states, since a fix that simply
     * stopped honouring the checkbox would pass a one-sided test.
     */
    const stubWorld = (shake) => ({
      scene: new THREE.Scene(),
      settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
      terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
        half: 200, surfaceAt: () => 'sand', crater() {} },
      particles: null, bolts: null, time: 0, combatIntensity: 0, training: false,
      physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
        addJoint() {}, removeJoint() {} },
      engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {}, rumble() {},
        setDrain() {}, setBars() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
      report() {}, notify() {}, killTime() {}, setTimeScale() {}, onPlayerDeath() {},
      feelOn: (kind) => (kind === 'shake' ? shake : true),
    });

    const die = (shake) => {
      const w = stubWorld(shake);
      const p = new Player(w, { isLocal: true });
      p.position.set(0, 0, 0);
      const input = { keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
        accel: { x: 0, y: 0 }, bindings: null, moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
        act: () => false, actHit: () => false };
      const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null,
        camera: w.engine.camera, time: 0, groundColor: 0, enemies: [] };
      for (let i = 0; i < 8; i++) { ctx.time = w.time = i / 60; p.update(1 / 60, ctx); }
      p.camera.firstPerson = true;
      p._applyViewMode();
      const yaw0 = p.camera.yaw;
      p.hp = 1;
      p.damage(999, null, null, 'saber');
      for (let i = 0; i < 40; i++) { ctx.time = w.time += 1 / 60; p.update(1 / 60, ctx); }
      return { p, fp: p.camera.firstPerson, dist: p.camera.distance, turned: Math.abs(p.camera.yaw - yaw0) };
    };

    const off = die(false);
    const on = die(true);
    for (const [label, r] of [['off', off], ['on', on]]) {
      assert(!r.p.alive, `the fixture did not die with shake ${label}`);
      assert(r.fp === false,
        `with camera shake ${label} the lens is still in first person while the body is a corpse — `
        + 'the death is watched from inside your own head');
      assert(r.dist > 1.5,
        `with camera shake ${label} the boom sat ${r.dist.toFixed(2)} m from the body`);
    }
    /* AND THE CHECKBOX STILL DOES ITS JOB: the SCRIPT — the turn around the
     * body — is the part motion feedback owns, and it must be gone with the
     * box unticked or this fix has quietly overridden a player's setting. */
    assert(on.turned > 0.2,
      `with shake on the death shot only turned ${on.turned.toFixed(3)} rad — there is no script to switch off`);
    assert(off.turned < 1e-9,
      `with shake off the camera still swung ${off.turned.toFixed(3)} rad around the body`);
    return `shake off: firstPerson ${off.fp}, boom ${off.dist.toFixed(2)} m, ${off.turned.toFixed(3)} rad of script; `
      + `shake on: boom ${on.dist.toFixed(2)} m, ${on.turned.toFixed(2)} rad`;
  });

  check('controls: the shake runs on the game clock, not on the wall clock', () => {
    /**
     * WHAT THIS CAUGHT, and it was reported as a flaky test rather than as the
     * bug it is. The shake's phase was `performance.now() * 0.001 + seed`, so:
     *
     *   · under a hitstop the world runs at 0.06× and the wall clock does not,
     *     and the camera buzzed at full rate through the one moment the whole
     *     effect exists for;
     *   · a paused game's shake kept advancing behind the pause menu;
     *   · and in any run where a frame does not take 1/60 of a second — which
     *     is every headless run and every real frame that is not exactly 60 fps
     *     — the FREQUENCY was wrong. Headless, the wall clock advanced by the
     *     time the frame took to compute, so the 47 rad/s term moved 0.005 rad
     *     a frame instead of 0.79: a frozen direction with a decaying
     *     magnitude, and the assertion above measured wherever in the sine the
     *     machine happened to be. It failed once at 0.238° against 1.17.
     *
     * So the claim is about FREQUENCY, which is the thing a wall clock gets
     * wrong and a peak does not necessarily. Two runs over the same four
     * seconds of game time at 60 and 120 fps have to shake the same number of
     * times; on the old code the 120 fps run shakes about twice as fast,
     * because it spends twice as many wall-clock milliseconds getting there.
     */
    const cycles = (dt) => {
      const still = driveRig(null, { dt, kick: 0 });
      const on = driveRig({ ...DEFAULT_SETTINGS, shake: true }, { dt });
      let crossings = 0, prev = 0;
      for (let i = 0; i < on.eyes.length; i++) {
        const d = on.eyes[i].x - still.eyes[i].x;
        if (Math.abs(d) < 1e-5) continue;
        if (prev !== 0 && Math.sign(d) !== prev) crossings++;
        prev = Math.sign(d);
      }
      return crossings / 2;              // a cycle is two crossings
    };
    const slow = cycles(1 / 60), fast = cycles(1 / 120);
    /* 47.3 rad/s is 7.53 Hz, and the run is four seconds — but the shake decays
     * at 5.5/s between kicks half a second apart, so the tail of each burst
     * falls under the 1e-5 floor and the count lands a little short of 30. The
     * bar is that it is a real oscillation at both rates and that the two agree,
     * not that it hits a number nobody would re-derive. */
    assert(slow > 12, `the shake completed ${slow} cycles in four seconds — it is not oscillating`);
    assert(Math.abs(fast - slow) <= Math.max(2, slow * 0.15),
      `the shake ran ${slow} cycles at 60 fps and ${fast} at 120 — its frequency is tied to the frame `
      + 'rate, so it is reading a clock the game does not control');
    return `${slow} cycles at 60 fps, ${fast} at 120, over the same four seconds of game time`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. Cinematic slow-motion                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: unticking Cinematic slow-motion actually stops time dilating', () => {
    const on = clockWorld({ ...DEFAULT_SETTINGS, slowmo: true });
    const off = clockWorld({ ...DEFAULT_SETTINGS, slowmo: false });

    // 0.12 s is the longest hitstop in the game (a Force rend); at 60 Hz that
    // is a little over seven frames of dilation.
    on.addHitstop(0.12);
    off.addHitstop(0.12);
    const tOn = timeScaleTrace(on, 12);
    const tOff = timeScaleTrace(off, 12);

    const minOn = Math.min(...tOn), minOff = Math.min(...tOff);
    const dilated = tOn.filter(v => v < 0.5).length;
    assert(minOn < 0.1, `slow-mo ON never took the world below ${minOn.toFixed(3)}× real time`);
    assert(dilated >= 7, `only ${dilated} frames were dilated by a 0.12 s hitstop`);
    // 1e-9, not exactly 1: world.time is an accumulator, so a per-frame ratio
    // taken off it carries float noise. Anything the toggle let through would
    // be 0.06, six orders of magnitude away from that.
    assert(minOff > 1 - 1e-6, `slow-mo OFF still ran a frame at ${minOff.toFixed(6)}× real time`);
    assert(off.hitstop === 0, `slow-mo OFF still banked ${off.hitstop} s of hitstop`);

    // Focus and Force sense are abilities, not cinematics, and must survive the
    // toggle — they bend time through targetTimeScale and focus.scale, which
    // this gate has no business touching.
    off.setTimeScale(0.42);
    const sensed = timeScaleTrace(off, 30);
    assert(Math.min(...sensed) < 0.6,
      `Force sense stopped working with slow-motion off: floor ${Math.min(...sensed).toFixed(3)}×`);
    return `hitstop: ON ${minOn.toFixed(3)}× for ${dilated} frames, OFF ${minOff.toFixed(3)}× flat; `
      + `Force sense still reaches ${Math.min(...sensed).toFixed(2)}× with the toggle off`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. Cleaving Throw                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: Cleaving Throw passes the blade through bodies a stock throw misses', () => {
    const boon = BOONS.find(b => b.id === 'saberthrow');
    assert(boon, 'the Cleaving Throw card is gone from BOONS');

    // Six bodies in a line: two droid-plated, two armoured, two heavy.
    const MIX = [TOUGHNESS.droid, TOUGHNESS.armour, TOUGHNESS.heavy];

    /**
     * One throw down the line. The SOLVER runs on the same flight in both runs,
     * exactly as World._resolveBlades runs it every frame, so "stock" is what a
     * thrown blade really takes today and not an empty baseline.
     */
    const fly = (withBoon) => {
      const cleaved = [];
      const w = targetsWorld(6, 4, cleaved, MIX);
      const p = thrower(w);
      if (withBoon) boon.apply(p);
      // the throw itself, exactly as throwOrRecall sets it up
      p.throwState = 'flying';
      p.throwPos.set(0, 1.25, 0);
      p.throwVel.set(0, 0, -26);
      p.throwTimer = 0;
      const solver = new BladeContactSolver();
      const solved = new Set();
      const ctx = { particles: null };
      const zero = new THREE.Vector3();
      for (let i = 0; i < 90 && p.throwState !== 'held'; i++) {
        p._updateThrow(1 / 60, ctx);
        p.saber.update(1 / 60, i / 60, zero);
        for (const ev of solver.solve(p.saber, solverTargets(w), 1 / 60, { power: 1 })) {
          if (ev.type === 'cut') solved.add(ev.target.id);
        }
      }
      const passed = new Set(cleaved.map(c => c.id));
      for (const id of solved) passed.add(id);
      return { cleaved, solved: solved.size, passed: passed.size, p };
    };

    const stock = fly(false);
    const cleave = fly(true);
    assert(cleave.passed >= 5, `a cleaving throw only passed through ${cleave.passed} of 6 bodies`);
    assert(cleave.passed > stock.passed,
      `cleaving took ${cleave.passed} bodies and the stock throw took ${stock.passed} — the card buys nothing`);
    assert(stock.passed < 6,
      `the stock throw already took all 6 (${stock.solved} by the solver) — this measures nothing`);
    const cuts = cleave.cleaved;
    // once each, never twice: the flight is one pass, not a saw
    const perBody = new Map();
    for (const c of cuts) perBody.set(c.id, (perBody.get(c.id) || 0) + 1);
    const doubled = [...perBody].filter(([, n]) => n > 1);
    assert(!doubled.length, `cleaved the same body twice on one flight: ${doubled.map(([id, n]) => `${id}×${n}`).join(', ')}`);
    assert(cleave.p.throwCleaves === perBody.size,
      `the blade counted ${cleave.p.throwCleaves} passes but produced ${perBody.size}`);
    assert(cleave.p.boonMods.throwPierce === true,
      'the boon did not report itself live, so nothing downstream can read it');
    return `bodies taken per throw down a line of 6 (2 droid, 2 armour, 2 heavy): `
      + `stock ${stock.passed} (solver ${stock.solved}), cleaving ${cleave.passed} (solver ${cleave.solved}, cleave ${perBody.size})`;
  });

  check('controls: Cleaving Throw returns the blade in half the time', () => {
    const boon = BOONS.find(b => b.id === 'saberthrow');

    const recall = (withBoon) => {
      const w = targetsWorld(0, 4, []);
      const p = thrower(w);
      if (withBoon) boon.apply(p);
      // 30 m out and already turning for home — the far end of a real throw
      p.throwState = 'returning';
      p.throwPos.set(0, 1.25, -30);
      p.throwVel.set(0, 0, -6);
      p.throwTimer = 1.5;
      p.control.handPos.set(0, 1.35, 0);
      let f = 0;
      const ctx = { particles: null };
      while (p.throwState !== 'held' && f < 1200) { p._updateThrow(1 / 60, ctx); f++; }
      assert(p.throwState === 'held', 'the blade never came home');
      return f / 60;
    };

    const stock = recall(false);
    const fast = recall(true);
    const ratio = stock / fast;
    assert(ratio > 1.7 && ratio < 2.4,
      `the cleaving recall is ${ratio.toFixed(2)}× the stock speed, and the card says twice`);
    assert(Math.abs(ratio - CLEAVE.recall) < 0.25,
      `CLEAVE.recall says ${CLEAVE.recall} but the blade measured ${ratio.toFixed(2)}×`);
    return `30 m recall: stock ${(stock * 1000).toFixed(0)} ms, cleaving ${(fast * 1000).toFixed(0)} ms (${ratio.toFixed(2)}×)`;
  });

  check('controls: cutting a prop mid-flight does not saw it to atoms in one frame', () => {
    // World._applyBladeEvent pushes the two halves of a cut prop onto
    // world.props. Walking that array with for…of while cutting into it means
    // the halves are inside the same disc, get cut, push more halves, and a
    // crate reaches its generation cap on a single frame. The sweep is bounded
    // by the length it started with; this is what holds that.
    let nextId = 100;
    /* THE HALVES REGISTER THEMSELVES, which is what a real `Prop` does now:
     * its constructor puts it in `world.props` (see the note there — a level
     * built twenty-one spires with a bare `makeSpire()` and got twenty-one
     * unsynced colliders out of it), so `_applyBladeEvent` no longer pushes
     * them and a stub that does not self-register measures nothing. The
     * property under test is unchanged: the sweep is bounded by the length the
     * array had when it started, so a half cannot be cut in the same frame. */
    let bench = null;
    const makeProp = (z, gen) => {
      const q = {
        id: 'p' + (nextId++), dead: false, gen,
        capsules: () => [{ name: 'c0', p0: new THREE.Vector3(0, 1.2, z), p1: new THREE.Vector3(0, 1.2, z), r: 0.45 }],
        cut() {
          if (this.gen >= 2) return null;
          return [makeProp(z - 0.2, this.gen + 1), makeProp(z + 0.2, this.gen + 1)];
        },
        shatter() { this.dead = true; },
      };
      if (bench && !bench.props.includes(q)) bench.props.push(q);
      return q;
    };

    const w = targetsWorld(0);
    w.props = [];
    bench = w;
    makeProp(-8, 0); makeProp(-14, 0);
    w.bladeSolver = { clearTarget() {} };
    w.particles = { sparkBurst() {}, slag() {}, cutFlare() {} };
    w._applyBladeEvent = World.prototype._applyBladeEvent;

    const p = thrower(w);
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    p.throwState = 'flying';
    p.throwPos.set(0, 1.2, 0);
    p.throwVel.set(0, 0, -26);
    p.throwTimer = 0;
    for (let i = 0; i < 60 && p.throwState !== 'held'; i++) p._updateThrow(1 / 60, { particles: null });

    // Two crates, two halves each, and that is the end of it on this flight.
    assert(p.throwCleaves === 2, `cleaved ${p.throwCleaves} props where two were standing`);
    assert(w.props.length === 6, `${w.props.length} props after cutting two — the halves were cut again`);
    assert(w.props.filter(x => x.gen === 2).length === 0,
      'the halves were re-cut inside the same sweep');
    return `2 crates → ${w.props.length} pieces (2 whole + 4 halves), ${p.throwCleaves} cleaves`;
  });

  check('controls: a cleave produces an event the real cut pipeline accepts', () => {
    // The count above uses a recording stub. This drives World's OWN
    // _applyBladeEvent with the event a cleave actually builds, so a cleave
    // cannot go on scoring while the shape it hands over has drifted.
    const took = [];
    const cuts = [];
    const w = targetsWorld(1, 4, cuts);
    w._applyBladeEvent = World.prototype._applyBladeEvent;
    w.particles = { sparkBurst() {}, slag() {}, cutFlare() {} };
    w.enemies[0].takeCut = (ev, source) => took.push({ ev, source });
    w.enemies[0].dead = false;
    const felt = { stop: 0, shake: 0 };
    w.addHitstop = (t) => { felt.stop = Math.max(felt.stop, t); };

    const p = thrower(w);
    p.camera = { addShake: (v) => { felt.shake = Math.max(felt.shake, v); } };
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    p.throwState = 'flying';
    p.throwPos.set(0, 1.25, 0);
    p.throwVel.set(0, 0, -26);
    p.throwTimer = 0;
    for (let i = 0; i < 30 && !took.length; i++) p._updateThrow(1 / 60, { particles: null });

    assert(took.length === 1, `World._applyBladeEvent produced ${took.length} cuts from one pass`);
    const { ev, source } = took[0];
    assert(source === p, 'the cut was not credited to the thrower');
    assert(ev.bone && ev.cap && isFinite(ev.cutT) && ev.point && ev.impulse && ev.normal,
      `the event is missing fields: ${JSON.stringify(Object.keys(ev))}`);
    assert(ev.cutT >= 0.06 && ev.cutT <= 0.94, `cutT ${ev.cutT} is outside a limb`);
    assert(p.limbsRemoved === 1 && p.score === 60,
      `the cut did not go through the scoring path: ${p.limbsRemoved} limbs, ${p.score} points`);
    // CLEAVE.speed exists to land on the heavy side of the hitstop step, which
    // World._applyBladeEvent puts at 20 m/s. If that step moves, the number has
    // to move with it, and this is what says so.
    assert(CLEAVE.speed > 20, `CLEAVE.speed ${CLEAVE.speed} is under the hitstop step`);
    assert(felt.stop === 0.055, `a cleave produced a ${felt.stop} s hitstop, not the heavy one`);
    assert(felt.shake === 0.3, `a cleave kicked the camera ${felt.shake}, not the cut ceiling`);
    return `cut ${ev.bone} at t=${ev.cutT.toFixed(2)}, credited ${p.score} points and ${p.limbsRemoved} limb, `
      + `${felt.stop} s hitstop and ${felt.shake} shake`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. Tab                                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: every registered action is handled by something', async () => {
    // The mirror of feel.mjs's check, which catches an action the game reads
    // but never registered. This catches the opposite and rarer one: an action
    // in the table, in the options screen and in the Codex that no code reads.
    // `scoreboard` sat there for the whole of v1.
    // The whole tree, not a hand-kept list: a list would have to be extended
    // every time a control moved file, and the check would go green for the
    // wrong reason the first time somebody forgot.
    const { readdir } = await import('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u, prefix + e.name + '/');
        else if (e.name.endsWith('.js')) files.push([prefix + e.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(src(''), '');

    const readers = new Map();
    for (const [path, text] of files) {
      /* `actAxis` counts as reading the action, and it has to. A STICK — the
       * pad's or the touch pad's — only ever answers `actAxis`: `act(id)`
       * reads `touchHeld` and the key table, and a magnitude lives in neither.
       * The free camera was the last caller asking `act('moveF')`, and moving
       * it onto the axis (so a thumb can fly it) briefly made all four
       * movement keys read as handled by nobody. */
      for (const m of text.matchAll(/\.act(?:Hit|Axis)?\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        if (!readers.has(m[1])) readers.set(m[1], []);
        readers.get(m[1]).push(path);
      }
      /**
       * …AND A WHEEL DECLARES ITS ACTION AT THE CONSTRUCTION SITE.
       *
       * `RadialWheel` reads `input.act(this.action)`, which the regex above
       * cannot see through — and it is one class serving two wheels, so
       * inlining a literal would mean two copies of the geometry, the hit test
       * and the DOM pooling, which is the thing the class exists to prevent.
       *
       * What it does instead is name its action, by name, at the one place it
       * is built: `new RadialWheel(host, { action: 'emote' })`. That is the
       * same guarantee as a literal `act('emote')` — a wheel still cannot
       * reach this list without saying which action it answers — and it is the
       * same widening the ORDER_ACTIONS clause below already makes.
       */
      for (const m of text.matchAll(/\baction:\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        if (!readers.has(m[1])) readers.set(m[1], []);
        readers.get(m[1]).push(path);
      }
    }
    /**
     * THE ORDERS ARE READ THROUGH A REGISTRY, NOT BY NAME, and the regex above
     * cannot see that — by construction, because the whole point of the seam is
     * that nobody types `'form.circle'` anywhere.
     *
     * So they are credited against the seam itself, stated: main.js must walk
     * `ORDER_ACTIONS` and ask `actHit` for each row's own action id. Delete the
     * loop and this fails exactly as a dead action would; replace it with six
     * literal `actHit('form.…')` calls and the readers map picks them up on the
     * ordinary path instead. Either way an order key that nothing presses is
     * still caught.
     */
    const orderIds = new Set(ORDER_ACTIONS.map(o => o.action));
    if (orderIds.size) {
      const mainSrc = files.find(([p]) => p === 'main.js')?.[1] || '';
      const walks = /for\s*\(\s*const\s+(\w+)\s+of\s+ORDER_ACTIONS\s*\)/.exec(mainSrc);
      assert(walks, 'main.js no longer walks ORDER_ACTIONS, so the order keys are read by nobody');
      assert(new RegExp(`\\.actHit\\(\\s*${walks[1]}\\.action\\s*\\)`).test(mainSrc),
        `main.js walks ORDER_ACTIONS but never asks input.actHit(${walks[1]}.action) — `
        + 'the orders are back to being raw key codes');
    }
    // moveF..moveR come through Input.moveAxis, which names every one of them.
    const dead = ACTION_IDS.filter(id => !readers.has(id) && !orderIds.has(id));
    assert(!dead.length,
      `bound, listed and handled by nobody: ${dead.join(', ')} — every one is a key that does nothing`);
    assert(readers.get('scoreboard').includes('main.js'),
      `the scoreboard is read in ${readers.get('scoreboard').join(', ')}, not where the overlay lives`);
    return `${ACTION_IDS.length} actions read across ${files.length} files, none dead; `
      + `scoreboard in ${readers.get('scoreboard').join(', ')}`;
  });

  check('controls: everything that drives a frame closes the input frame', async () => {
    /**
     * THE ENDLESS SPIN.
     *
     * `Input` accumulates `mouse.dx/dy` from every mousemove and clears them in
     * `end()`. It is a per-frame delta, consumed exactly once. A loop that
     * reads it and never calls `end()` therefore does not read "how far the
     * mouse moved this frame" — it reads how far the mouse has moved since the
     * page opened, and yaws by that amount every frame. The camera accelerates
     * into a spin nothing can stop, which is precisely what the cel-shading
     * meadow shipped as, and it was reported as unusable and nauseating.
     *
     * `end()` also clears `pressed`/`released`, so the same omission re-fires
     * every one-shot action — jump, ignite, throw — on every frame.
     *
     * It is a contract, not a convention, so it is checked as one across the
     * whole tree rather than in main.js alone. Anything that hands an Input to
     * a world update owns both halves of the frame.
     */
    const { readdir } = await import('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u, prefix + e.name + '/');
        else if (/\.(js|html)$/.test(e.name)) files.push([prefix + e.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(new URL('../../', import.meta.url), '');

    /*
     * Whoever CONSTRUCTS an Input owns its frame, and that is the test — not
     * "who calls a world update", which matches World.js's own signature and
     * every object it forwards the input to. There are exactly two owners
     * today, main.js and the toon meadow, and the second one is the one that
     * shipped broken.
     */
    const drivers = files.filter(([, t]) => /\bnew\s+Input\s*\(/.test(t));
    assert(drivers.length >= 2,
      `only ${drivers.length} Input owners found — the pattern this check scans for has moved and it is now looking at nothing`);
    const half = [];
    for (const [path, text] of drivers) {
      const b = /\binput\.begin\s*\(/i.test(text), e = /\binput\.end\s*\(\s*\)/i.test(text);
      if (!b || !e) half.push(`${path} (${b ? 'begin' : 'no begin'}, ${e ? 'end' : 'NO END'})`);
    }
    assert(!half.length,
      `drives a frame without closing the input frame: ${half.join(', ')} — `
      + 'the mouse delta never clears, so the camera spins faster every frame');
    return `${drivers.length} Input owners, all closing the frame: ${drivers.map(([p]) => p).join(', ')}`;
  });

  check('controls: the scoreboard overlay exists and Tab is what opens it', async () => {
    const html = await read('index.play.html');
    const main = await read('src/main.js');
    for (const id of ['scoreboard', 'score-stats', 'score-boons', 'score-roster']) {
      assert(html.includes(`id="${id}"`), `index.html has no #${id} for the scoreboard to fill`);
    }
    assert(/getElementById\('scoreboard'\)/.test(main), 'main.js never looks the overlay up');
    assert(/act\('scoreboard'\)/.test(main), 'main.js never reads the scoreboard action');
    // It must not be wired to a raw key code — that is how it would stop being
    // rebindable, which is the state four other actions were rescued from.
    assert(!/code\s*===\s*'Tab'\s*\)\s*\{?\s*set/.test(main), 'the scoreboard is driven off a raw Tab');
    const b = defaultBindings();
    assert(b.scoreboard.includes('Tab'), `the scoreboard defaults to ${b.scoreboard.join('+')}, and the Codex says Tab`);
    assert(ACTIONS.find(a => a.id === 'scoreboard').hold, 'the scoreboard is documented as a hold and is not marked hold');
    // The overlay prints the key you hold to see it, so that label has to come
    // from the binding. A typed "Tab" is a lie the moment anybody rebinds it.
    assert(html.includes('id="score-key"'), 'the overlay has no slot for the live key label');
    /*
     * …AND IT FOLLOWS THE DEVICE, not only the binding.
     *
     * This asserted `keyLabel((input.bindings.scoreboard` — the label was read
     * off the table, which was the whole of the claim while a keyboard was the
     * only thing you could play with. A pad player holding this overlay open
     * was told to hold Tab. `liveKey` is main.js's one helper for "what is this
     * action called on the thing in the player's hands", and both halves are
     * pinned: the caption goes through it, and it goes through the table.
     */
    assert(/scoreEl\.key\.textContent = liveKey\('scoreboard'\)/.test(main),
      'the scoreboard prints a hardcoded key instead of the one it is bound to');
    assert(/const liveKey = \(id\) => keyLabel\(codesFor\(input\.bindings, id, input\.device\)/.test(main),
      'liveKey no longer reads the bindings table and the active device — the caption can go stale again');
    return `#scoreboard filled from act('scoreboard'), default ${b.scoreboard.join('+')}, hold, label from the binding`;
  });

  check('controls: the order keys are in the table, and the table is not a copy', async () => {
    /**
     * WHAT THIS IS FOR.
     *
     * main.js used to read the orders as RAW key codes — `input.hit(F.key)`,
     * straight off `FORMATIONS`, past ACTIONS entirely. Six controls that were
     * not rebindable, on no controls card, in no Codex row, and — the part that
     * makes it a bug rather than an omission — invisible to `findConflicts`,
     * which reported Digit6-Digit0 and Minus as FREE. The options screen would
     * hand one of them to something else, warn about nothing, and no rebind
     * could separate the pair afterwards.
     *
     * The obvious repair is six literal rows in Bindings.js. That is HANDOFF
     * §2.3 — a hand-written table beside its generated twin — and it fails
     * SILENTLY: change a key in Command.js and the copy goes on describing a
     * game that stopped existing. So the rows are derived, and this check is the
     * thing that says so: it re-derives them from `FORMATIONS` itself and
     * compares field by field. A hand-edited row cannot survive it.
     */
    assert(ORDER_ACTIONS.length === FORMATION_IDS.length,
      `${FORMATION_IDS.length} formations, ${ORDER_ACTIONS.length} registered orders — `
      + 'somebody added a formation and the bindings table did not follow');

    const b = defaultBindings();
    const wrong = [];
    for (const id of FORMATION_IDS) {
      const F = FORMATIONS[id];
      const action = orderActionId(id);
      const row = ACTIONS.find(a => a.id === action);
      if (!row) { wrong.push(`${id}: no action row at all`); continue; }
      if (row.group !== ORDER_GROUP) wrong.push(`${id}: group ${row.group}, not ${ORDER_GROUP}`);
      // The DEFAULT KEY is the field that drifts, because it is the one a
      // designer moves. It has exactly one author and this is the assertion
      // that keeps it that way.
      if ((b[action] || [])[0] !== F.key) {
        wrong.push(`${id}: bound to ${(b[action] || []).join('+') || 'nothing'}, Command.js says ${F.key}`);
      }
      if (!row.label.includes(F.name)) wrong.push(`${id}: label "${row.label}" does not name the formation`);
      const pub = ORDER_ACTIONS.find(o => o.action === action);
      if (pub?.blurb !== F.blurb) wrong.push(`${id}: the registry's blurb is not the formation's`);
    }
    assert(!wrong.length, wrong.join('; '));

    // Nothing typed the codes into this file's own layer either: no order key
    // may appear as a literal anywhere in Bindings.js or main.js.
    const bindingsSrc = await readFile(src('engine/Bindings.js'), 'utf8');
    const mainSrc = await readFile(src('main.js'), 'utf8');
    const keys = FORMATION_IDS.map(id => FORMATIONS[id].key);
    for (const [what, text] of [['Bindings.js', bindingsSrc], ['main.js', mainSrc]]) {
      // Comments are prose and may name a key; code may not. Strip both comment
      // forms before looking, or the notes explaining this very rule trip it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const typed = keys.filter(k => code.includes(`'${k}'`) || code.includes(`"${k}"`));
      assert(!typed.length,
        `${what} types the order key(s) ${typed.join(', ')} as a literal — that is the copy `
        + 'this seam exists to abolish');
    }

    // A registration run twice must not double the table. The seam is called
    // once today; "first one wins" is how a seam becomes the stale twin.
    const before = ACTION_IDS.length;
    registerOrders(FORMATIONS);
    assert(ACTION_IDS.length === before,
      `registering the orders a second time grew the table from ${before} to ${ACTION_IDS.length}`);

    // And they are reachable as ordinary bindings: no clash with anything, and
    // the conflict finder can now SEE them, which was the whole hole.
    assert(!conflicts(b).length, 'the shipped defaults clash once the orders are in the table');
    for (const id of FORMATION_IDS) {
      const found = findConflicts(b, FORMATIONS[id].key, null);
      assert(found.includes(orderActionId(id)),
        `findConflicts still reports ${FORMATIONS[id].key} as free — the options screen would `
        + 'hand it to something else without a warning');
    }
    return `${ORDER_ACTIONS.length} orders under "${ORDER_GROUP}": `
      + ORDER_ACTIONS.map(o => `${o.name} ${keyLabel(o.key)}`).join(', ');
  });

  check('controls: no shipped default binds one key to two actions', () => {
    // The shipped table had `thrust: ['Mouse2']` and `hurl: ['Mouse2']`. A
    // fresh profile therefore had one button firing two things, and the options
    // screen could not say so, because findConflict only ever looked at the key
    // you were TYPING — never at the table it was typing into.
    const clash = conflicts(defaultBindings());
    assert(!clash.length, 'the shipped defaults bind one key to two actions: '
      + clash.map(c => `${c.code} → ${c.ids.join(' + ')}`).join('; ')
      + ' — no rebind can separate them');
    const b = defaultBindings();
    let n = 0;
    for (const id of ACTION_IDS) n += b[id].length;
    return `${ACTION_IDS.length} actions, ${n} bound keys, no key answered by two`;
  });

  check('controls: the rebinder settles EVERY clash, not the first one', () => {
    // Reproduce the shipped state — Mouse2 on two actions — through
    // _buildBindings.finish()'s own logic, which is: ask the resolver, then
    // write the key. Both victims are given a spare so that "could not settle"
    // is never the reason either version leaves a duplicate behind.
    /* THE SPARES ARE FOUND, NOT TYPED. They were 'KeyU' and 'KeyI', and the
     * day an action took KeyU this fixture started manufacturing a clash of
     * its own — the check failed reporting "Mouse2 still answers to
     * thrust+unleash", which is a defect in the test data and not in the
     * resolver. Two keys that nothing in `defaultBindings()` claims, picked
     * off the real table, cannot go stale that way.
     *
     * AND THEY ARE NOT LOOKED FOR AMONG THE LETTERS ANY MORE. There are 26 of
     * those and 46 actions, and the day `withdraw` took KeyL exactly one was
     * left — so this went red saying the fixture had no spares, which is true
     * and is a fact about the keyboard rather than about the resolver. The
     * pool is now everything a real profile can hold and a shipped default
     * does not reach for: the letters first, so the failure message still
     * reads like a keyboard, then the digits and the high function keys.
     * `resolveConflicts` does not care what a code spells. */
    const spares = () => {
      const b = defaultBindings();
      const used = new Set(Object.values(b).flat());
      const pool = [
        ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => `Key${c}`),
        ...[...'0123456789'].map(d => `Digit${d}`),
        ...Array.from({ length: 12 }, (_, i) => `F${13 + i}`),
      ];
      const free = [];
      for (const c of pool) {
        if (!used.has(c)) free.push(c);
        if (free.length === 2) break;
      }
      assert(free.length === 2,
        'the bindings table has no two unbound keys left in the letters, the digits or F13-F24 '
        + '— this fixture needs spares to give up');
      return free;
    };

    /* THE CLASHING CODE IS FOUND, NOT TYPED, for exactly the reason the spares
     * are. It was 'Mouse2', which was `thrust`'s own key when this was written
     * — then the mouse buttons were swapped so that RMB guards and LMB attacks
     * (see Bindings.js), `blade` took Mouse2, and the fixture was quietly
     * manufacturing a THREE-way clash: the resolver correctly took the key off
     * all three and the check failed reporting a defect in the test data.
     * `thrust`'s first key, whatever it is, plus two spares, is a two-way clash
     * by construction and cannot go stale that way. */
    const CODE = defaultBindings().thrust[0];
    const doubled = () => {
      const b = defaultBindings();
      const [s1, s2] = spares();
      b.thrust = [CODE, s1]; b.hurl = [CODE, s2];
      return b;
    };

    const old = doubled();
    // what finish() used to do, verbatim
    const first = findConflict(old, CODE, 'dash');
    const rest = old[first].filter(k => k !== CODE);
    if (rest.length) old[first] = rest;
    old.dash = [CODE];
    const left = conflicts(old);
    assert(left.length > 0,
      'the single-clash path was supposed to leave a duplicate behind and did not — '
      + 'this check no longer reproduces the bug it exists for');

    const now = doubled();
    const res = resolveConflicts(now, CODE, 'dash');
    now.dash = [CODE];
    assert(!conflicts(now).length,
      `after settling, ${CODE} still answers to ${conflicts(now).map(c => c.ids.join('+')).join(', ')}`);
    assert(res.taken.length === 2 && !res.refused.length,
      `both victims had a spare, so both should give the key up, not ${JSON.stringify(res)}`);
    assert(now.thrust.length === 1 && now.hurl.length === 1, 'a victim lost more than the clashing key');

    // An action down to its LAST key keeps it and is reported, rather than
    // being silently muted — the one thing worse than a duplicate.
    //
    // THE PREMISE IS STATED AND NO LONGER ASSUMED. This read `defaultBindings()`
    // and relied on Force push happening to ship with exactly one key, which
    // stopped being true the day every action gained a pad code: push became
    // ['KeyF', 'PadLB+PadA'], the resolver correctly TOOK KeyF because a
    // binding was left, and the check failed reporting a defect in the
    // resolver that was a defect in its own fixture. Same shape as the note on
    // `spares()` above, and the same fix — say what the fixture needs.
    const last = defaultBindings();
    last.push = ['KeyF'];
    const r3 = resolveConflicts(last, 'KeyF', 'view');
    assert(r3.refused.includes('push') && last.push.includes('KeyF'),
      'an action on its last key was left unbound');
    return `first-only left ${left.map(c => c.ids.join('+')).join(', ')}; `
      + 'resolveConflicts clears all of them and refuses to mute an action';
  });

  check('controls: a SAVED blob cannot boot into a clash the defaults do not have', () => {
    /**
     * THE DEFAULTS MOVE; A SAVED TABLE DOES NOT.
     *
     * `saveBindings` writes the WHOLE table the first time anything is rebound
     * — or Reset is pressed — so every returning player carries a snapshot of
     * the defaults of the day they touched the controls screen, and
     * `loadBindings` merged it over today's table without ever asking
     * `conflicts()`. Measured against the table five commits back: Mouse4 on
     * `dash` AND `attackSpin`, CapsLock on `grip2` AND `stratagem`, KeyT on
     * `focus` AND `orderwheel`, and `PadLB+PadBack` on `flourish` AND
     * `orderwheel` — the chord-order collision `chordKey` exists to abolish,
     * arriving back out of storage. `conflicts(defaultBindings())` was 0
     * throughout, which is why the check above could not see any of it.
     *
     * Driven over EVERY action rather than against one transcribed blob: the
     * stale table of five commits back is a fact about one day, and the class
     * is "a key this action used to own now belongs to another one". Fifty
     * blobs, each one a default key moved somewhere it does not belong.
     */
    const store = new Map();
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    try {
      const def = defaultBindings();
      let worst = 0, cases = 0;
      for (const id of ACTION_IDS) {
        const other = ACTION_IDS.find(x => x !== id);
        const stale = structuredClone(def);
        // the key `id` holds today, saved against the action that used to hold it
        stale[other] = [def[id][0], ...(def[other] || [])].slice(0, 3);
        store.clear();
        store.set('saber.bindings.v2', JSON.stringify(stale));
        worst = Math.max(worst, conflicts(stale).length);
        const got = loadBindings();
        cases++;
        assert(!conflicts(got).length,
          `a saved blob booted into ${conflicts(got).map(c => `${c.code} → ${c.ids.join('+')}`).join(', ')}`);
        const mute = ACTION_IDS.filter(a => !(got[a] || []).length);
        assert(!mute.length, `settling left ${mute.join(', ')} answering to nothing`);
      }
      // a table that is ALREADY clean is left exactly as the player wrote it —
      // settling must not be a second Reset to defaults
      store.clear();
      const chosen = structuredClone(def);
      const [free] = freeCodes(1);
      chosen.jump = [free];
      store.set('saber.bindings.v2', JSON.stringify(chosen));
      assert(loadBindings().jump[0] === free, 'settling threw away a deliberate rebind');
      return `${cases} stale blobs, up to ${worst} clash each → 0 after load, nothing muted, `
        + 'a clean rebind untouched';
    } finally { globalThis.localStorage = real; }
  });

  check('controls: the v1 blob does not pin a returning player to the old mouse scheme', () => {
    /**
     * Player note #15 swapped the mouse: RMB guards, LMB attacks. Anybody who
     * had ever rebound anything — or pressed Reset — had the old pair on disk,
     * so the fix was invisible to exactly the players who had opened the
     * controls screen. Measured off the real v1 table: `blade: Mouse1,
     * thrust: Mouse2`, the inverse of what ships, with no conflict to see it by.
     *
     * The two rows are retired by name the way Menu.js's RETIRED retires a
     * setting, so everything else the player chose survives the bump.
     */
    const store = new Map();
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    try {
      const def = defaultBindings();
      const [free] = freeCodes(1);
      // the v1 scheme, built by INVERTING today's pair rather than by typing
      // two codes that would go stale the next time the mouse moves
      const v1 = structuredClone(def);
      v1.blade = def.thrust.slice(); v1.thrust = def.blade.slice();
      v1.jump = [free];
      store.set('saber.bindings.v1', JSON.stringify(v1));
      const got = loadBindings();
      assert(got.blade[0] === def.blade[0] && got.thrust[0] === def.thrust[0],
        `a v1 blob still holds the old mouse scheme: blade ${got.blade[0]}, thrust ${got.thrust[0]}`);
      assert(got.jump[0] === free, 'retiring the mouse pair threw away the rest of the blob');
      assert(!store.has('saber.bindings.v1'), 'the retired blob speaks more than once');
      return `v1 blade/thrust ${v1.blade[0]}/${v1.thrust[0]} → ${got.blade[0]}/${got.thrust[0]}, `
        + `jump ${free} kept, v1 drained`;
    } finally { globalThis.localStorage = real; }
  });

  check('controls: a clash the rebinder REFUSES to settle is on the screen', async () => {
    /**
     * `resolveConflicts` refuses to take an action's last key — right, because
     * the alternative is an action that answers to nothing — so a duplicate
     * the player can SEE is the intended outcome, and the seeing half was
     * missing. `conflicts()` had no caller in src/ at all: its definition and
     * one comment. `.bindrow b.conflict{background:var(--danger)}` sat in
     * styles.css with nothing that ever added the class.
     *
     * Measured by binding all fifty actions to one key through the real
     * rebinder: K was left answering for EIGHT actions, seven of them
     * formation orders, the `#bind-hint` sentence named only the last refusal
     * and was cleared by the next rebind, and not one row on screen said so.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu } = await import('../../src/ui/Menu.js');
    const INDEX = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const CSS = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
    assert(/\.bindrow b\.conflict\s*\{/.test(CSS), 'the clash paint rule is gone from styles.css');

    const doc = makeDocument(INDEX);
    const restore = doc.install();
    const listeners = new Map();
    const realAdd = globalThis.addEventListener, realRem = globalThis.removeEventListener;
    globalThis.window = globalThis;
    globalThis.addEventListener = (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); };
    globalThis.removeEventListener = (t, fn) => {
      const a = listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    };
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
      const host = doc.getElementById('bind-list');
      const CODE = 'KeyK';
      for (let n = 0; n < ACTIONS.length; n++) {
        const chip = host.querySelectorAll('.bindrow')[n].querySelector('b');
        chip.click();
        (listeners.get('keydown') || [])[0]?.({ code: CODE, preventDefault() {}, stopPropagation() {} });
      }
      const left = conflicts(menu.bindings);
      assert(left.length, 'this fixture no longer produces a clash the resolver refuses');
      const owners = left.reduce((n, c) => n + c.ids.length, 0);
      const marked = host.querySelectorAll('b.conflict');
      assert(marked.length === owners,
        `${owners} actions share a key and ${marked.length} chips are marked`);
      for (const chip of marked) {
        assert(/ is also /.test(chip.title || ''),
          'a marked chip does not name the action it is sharing with');
      }
      return `50 actions onto ${CODE} → ${owners} left sharing it, ${marked.length} chips lit and named`;
    } finally {
      restore();
      globalThis.addEventListener = realAdd; globalThis.removeEventListener = realRem;
    }
  });

  check('controls: the dojo steps lessons through the bindings table, not off raw keys', async () => {
    const main = await read('src/main.js');
    // The exact shape that shipped, beside a table that had just been given
    // stasis on B and rend on N so the collision could be SEEN.
    for (const [code, verb] of [['KeyN', 'skip'], ['KeyB', 'back'], ['KeyY', 'repeat']]) {
      const re = new RegExp(`code\\s*===\\s*'${code}'[^\\n]*\\.${verb}\\(`);
      assert(!re.test(main), `main.js still steps the lesson off a raw ${code}`);
    }
    for (const [id, verb] of [['lessonNext', 'skip'], ['lessonBack', 'back'], ['lessonRepeat', 'repeat']]) {
      assert(ACTION_IDS.includes(id), `${id} is not in the bindings table, so it cannot be rebound`);
      const re = new RegExp(`act(?:Hit)?\\('${id}'\\)[^\\n]*\\.${verb}\\(`);
      assert(re.test(main), `${id} is registered but nothing calls director.${verb}()`);
      assert(typeof DojoDirector.prototype[verb] === 'function',
        `DojoDirector.${verb} is gone — ${id} has nothing to drive`);
    }
    // And the keys they got must not be the keys of anything else, in a fresh
    // profile OR after the Force powers moved: that was the whole bug.
    const b = defaultBindings();
    for (const id of ['lessonNext', 'lessonBack', 'lessonRepeat']) {
      for (const code of b[id]) {
        const other = findConflict(b, code, id);
        assert(!other, `${id} defaults to ${code}, which ${other} also answers to`);
      }
    }
    // The coach panel's legend has to come from the table too — index.html
    // shipped `N next / B back / R etry with Y` baked into the markup.
    assert(/coach-keys/.test(main) && /keyLabel\(/.test(main),
      'the coach panel still prints hardcoded keys instead of the bound ones');
    return `lesson nav on ${['lessonNext', 'lessonBack', 'lessonRepeat'].map(i => b[i][0]).join('/')}, `
      + 'read as actions, legend from the bindings';
  });

  check('controls: one key press, one action — through the real Input', () => {
    // Not a source scan. A real Input, with the shipped bindings, fed the key
    // the way tools/smoke.mjs feeds the live game, and asked which actions
    // answer. With a fresh profile KeyB used to answer `stasis` AND run
    // director.back(), and KeyN `rend` AND director.skip() — two systems, one
    // press, and nothing in the table able to say so.
    const input = new Input({ addEventListener() {}, requestPointerLock() {} });
    const answers = (code) => {
      input.keys.clear(); input.pressed.clear();
      input.buttons.fill(false); input.buttonPressed.fill(false);
      if (code.startsWith('Mouse')) {
        const i = Object.keys(MOUSE).find(k => MOUSE[k] === code);
        input.buttons[i] = true; input.buttonPressed[i] = true;
      } else { input.keys.add(code); input.pressed.add(code); }
      return ACTION_IDS.filter(id => input.actHit(id) || input.act(id));
    };
    const doubled = [];
    for (const id of ACTION_IDS) {
      for (const code of input.bindings[id]) {
        const who = answers(code);
        if (who.length > 1) doubled.push(`${code} → ${who.join(' + ')}`);
      }
    }
    assert(!doubled.length, `one press, two systems: ${doubled.join('; ')}`);
    // and the three keys the dojo took answer to the dojo and to nothing else
    for (const id of ['lessonNext', 'lessonBack', 'lessonRepeat']) {
      const who = answers(input.bindings[id][0]);
      assert(who.length === 1 && who[0] === id,
        `${input.bindings[id][0]} answers to ${who.join(' + ')}, not just ${id}`);
    }
    assert(answers('KeyB').join() === 'stasis', 'KeyB still answers to more than the stasis field');
    assert(answers('KeyN').join() === 'rend', 'KeyN still answers to more than rend');
    let n = 0;
    for (const id of ACTION_IDS) n += input.bindings[id].length;
    return `${n} bound keys driven through Input, every one answered by exactly one action`;
  });

  check('controls: the training blade slider moves the blade that is in your hand', async () => {
    // The panel said "length is read when the blade is built — a change lands
    // on your next Ignite". It landed nowhere: hooks.onBladeLength was declared
    // in Menu and implemented in nothing.
    const saber = new Saber(new THREE.Scene(), { bladeLength: 1.15 });
    const before = saber.bladeLength;
    // main.js's hook, exactly as written there
    const hook = (v) => { const w = { player: { saber } }; if (w?.player?.saber) w.player.saber.bladeLength = v; };
    hook(4.0);
    assert(saber.bladeLength === 4.0, `the slider moved the blade from ${before} to ${saber.bladeLength}`);
    // and it has to be LIVE, i.e. the length the frame reads must follow —
    // Saber.update recomputes `len = bladeLength * ignition` every frame
    saber.lit = true;
    for (let i = 0; i < 120; i++) saber.update(1 / 60, i / 60);
    const tip = saber.tip.distanceTo(saber.base);
    assert(tip > 3.6, `after re-igniting at 4 m the blade measures ${tip.toFixed(3)} m`);
    hook(1.15);
    for (let i = 0; i < 120; i++) saber.update(1 / 60, 2 + i / 60);
    const back = saber.tip.distanceTo(saber.base);
    assert(back < 1.25, `after dragging back to 1.15 m the blade measures ${back.toFixed(3)} m`);

    const main = await read('src/main.js');
    assert(/onBladeLength\s*:/.test(main), 'main.js declares no onBladeLength — the hook is inert again');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    assert(/hooks\.onBladeLength\?\.\(/.test(menu), 'the training slider no longer calls the hook');
    // The panel must not promise the OLD behaviour either. It is live now.
    assert(!/lands on your\s*\n?\s*next Ignite/.test(menu),
      'the panel still says the change lands on your next Ignite');
    return `1.15 → 4.00 m live (tip ${tip.toFixed(2)} m), and back to ${back.toFixed(2)} m`;
  });

  check('controls: the pause training sliders show exactly where they bite', async () => {
    // Gating on the level name showed them for all eleven lessons;
    // Dojo.inSandbox is the one lesson that reads them. The forbidden pattern
    // below no longer names a level either: it used to spell out the exact
    // `level === 'dojo'` line that shipped, which stopped being a possible
    // regression the day that level was deleted while `level === 'meadow'`
    // remained perfectly writable. Any level name in that position is the bug.
    const main = await read('src/main.js');
    assert(/inSandbox/.test(main), 'main.js never asks the dojo whether this lesson is the sandbox');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    /* Scoped to showPause's own body. The first cut of this asserted "no
     * `this.s.level ===` anywhere in Menu.js", which is not the claim: the
     * level cards compare the selected key to each card's key to mark one
     * selected, and that is exactly what they should do. A guard that fails on
     * the correct code teaches people to delete the guard. */
    const body = menu.slice(menu.indexOf('showPause(stats, sandboxLive,'));
    const showPause = body.slice(0, body.indexOf('\n  }\n'));
    assert(showPause.length > 200 && showPause.length < 4000,
      `showPause could not be isolated (${showPause.length} chars) — the scan is not scanning`);
    assert(!/\bthis\.s\.level\s*===/.test(showPause), 'showPause is gated on the level name again');
    assert(/showPause\(stats, sandboxLive,/.test(menu), 'showPause no longer takes the live answer');

    // And the predicate main.js computes has to agree with the director on
    // every lesson, not just on the name of the level.
    const lessons = (await import('../../src/game/Dojo.js')).LESSONS;
    const inSandbox = lessons.map(L => !!L.setup?.sandbox);
    const n = inSandbox.filter(Boolean).length;
    assert(n >= 1, 'no lesson is the sandbox room at all');
    assert(n < lessons.length, 'every lesson is the sandbox room — the gate would be meaningless');
    assert(/sandboxRoomLive/.test(main), 'main.js has no single place that answers the question');
    return `${lessons.length} lessons, ${n} read the training numbers; the pause card asks the director`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. Nothing in the menu may be decorative                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: every column of the quality table is read by named code', async () => {
    const cols = Object.keys(QUALITY.low);
    for (const tier of Object.keys(QUALITY)) {
      const mine = Object.keys(QUALITY[tier]).sort().join(',');
      assert(mine === cols.slice().sort().join(','), `tier ${tier} does not have the same columns as low`);
    }
    const listed = Object.keys(QUALITY_READERS);
    const dead = cols.filter(c => !listed.includes(c));
    assert(!dead.length, `quality columns nothing in src/ reads: ${dead.join(', ')} — `
      + 'the tier promises something and delivers the tier above it');
    const stale = listed.filter(c => !cols.includes(c));
    assert(!stale.length, `QUALITY_READERS names columns that are gone: ${stale.join(', ')}`);

    // Same rule as SETTING_READERS: the declaration has to be TRUE, and the
    // expression has to actually mention the column. The manifest itself is cut
    // out of whatever file it is searched in, so an entry cannot satisfy itself
    // — this file is one of the files it names nothing in, but the next round's
    // move of the table into Engine.js must not quietly turn it green.
    const strip = (text) => {
      const a = text.indexOf('const QUALITY_READERS = {');
      if (a < 0) return text;
      const b = text.indexOf('\n};', a);
      return b < 0 ? text.slice(0, a) : text.slice(0, a) + text.slice(b);
    };
    const missing = [];
    for (const [col, [file, expr]] of Object.entries(QUALITY_READERS)) {
      assert(expr.includes(col), `the reader declared for ${col} does not mention it: ${expr}`);
      const text = await readFile(src(file), 'utf8').then(strip, () => null);
      if (text === null) { missing.push(`${col} → ${file} does not exist`); continue; }
      if (!text.includes(expr)) missing.push(`${col} → ${file} no longer contains \`${expr}\``);
    }
    assert(!missing.length, missing.join('; '));

    // And World must not have grown a second, private ladder beside it. That is
    // what it had: `{ low: 0.55, medium: 0.8, high: 1, ultra: 1.25 }`, inline,
    // deciding terrain and atmosphere while Engine's own table decided nothing.
    // Comments stripped first — the comment that RECORDS the old ladder is not
    // the old ladder, and a check that cannot tell the two apart would make
    // explaining the fix impossible.
    const world = (await readFile(src('game/World.js'), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/\{\s*low\s*:\s*[\d.]/.test(world),
      'World.js has an inline quality ladder again — one value, one home');
    assert(/QUALITY\[this\.settings\.quality\]/.test(world),
      'World.js no longer reads the tier off Engine\'s table');
    return `${cols.length} columns (${cols.join(', ')}), every one with a named reader`;
  });

  check('controls: the quality tier actually changes the particle and grass budgets', () => {
    // The measurement the Performance card rests on. Built through the real
    // constructors at the real tiers, with the player's own multipliers left at
    // 1 so what is being measured is the TIER.
    const tiers = ['low', 'medium', 'high', 'ultra'];
    const scene = new THREE.Scene();
    const terrain = new Terrain(scene, 'dunes', 1);
    const rows = tiers.map((t) => {
      const q = QUALITY[t];
      const p = new Particles(scene, 1 * q.particles);
      const g = new GrassField(scene, terrain, { count: Math.round(11000 * q.grass), density: 1, radius: 46 });
      const row = { t, pooled: p.stats().pools, chips: p.chips.max, decals: p.decals.max, blades: g.count };
      p.dispose(); g.dispose?.();
      return row;
    });
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].pooled > rows[i - 1].pooled,
        `${rows[i].t} pools ${rows[i].pooled} particles, ${rows[i - 1].t} pools ${rows[i - 1].pooled}`);
      assert(rows[i].blades > rows[i - 1].blades,
        `${rows[i].t} plants ${rows[i].blades} blades, ${rows[i - 1].t} plants ${rows[i - 1].blades}`);
    }
    // The tabled spread, minus whatever the pools' own floors take back. It was
    // 1.00 on both — 19,800 particles and 11,000 blades at low exactly as at
    // ultra — which is what makes a bare "> the tier below" too weak to pin it.
    const pSpread = rows[3].pooled / rows[0].pooled;
    const gSpread = rows[3].blades / rows[0].blades;
    assert(pSpread > 2.9, `particles spread only ${pSpread.toFixed(2)}× across the four tiers`);
    assert(gSpread > 5.5, `grass spreads only ${gSpread.toFixed(2)}× across the four tiers`);
    // And the player's own slider must still multiply the tier rather than
    // replace it — `particleScale ?? q` made the tier structurally unreachable.
    const half = new Particles(scene, 0.5 * QUALITY.ultra.particles);
    assert(half.stats().pools < rows[3].pooled,
      'halving particleScale did not thin the tier — the slider is replacing it, not scaling it');
    half.dispose();
    terrain.dispose?.();
    return rows.map(r => `${r.t} ${r.pooled}p/${r.blades}g`).join('  ')
      + `  (${pSpread.toFixed(2)}× / ${gSpread.toFixed(2)}×)`;
  });

  check('controls: no setting is read that nothing defaults — the guard is not the list', async () => {
    /**
     * THE HOLE IN THE OTHER TWO GUARDS, AND IT IS THE SHAPE OF THE HOLE THAT
     * MATTERS.
     *
     * "every setting in DEFAULT_SETTINGS is read" and "every setting has a
     * control" are both real checks and both iterate
     * `Object.keys(DEFAULT_SETTINGS)`. So the ONE class of dead control neither
     * can see is a setting that is READ by shipped code and never declared: it
     * is not a key, so it is in neither loop, so it needs no reader and no
     * control and nothing anywhere complains. A guard keyed on the list of
     * things you remembered to declare cannot find the thing you forgot to
     * declare.
     *
     * Four were hiding there and every one had a live reader:
     *
     *   settings.teamDamage        game/Command.js  — asked for by name in a
     *                                                 player note
     *   settings.commandFormation  game/Command.js
     *   settings.instantSpawn      game/Waves.js    — the gate on every
     *                                                 gunship, door and pod
     *   settings.maxBodies         game/World.js    — the physics body cap
     *
     * So this one runs the other way round: it finds what the SOURCE reads and
     * requires a default for it. Direct reads (`settings.x`, `world.settings.x`,
     * `this.settings?.x`) and the aliased idiom the config functions all use
     * (`const s = settings || {}` … `s.x`) — the second one scoped to the block
     * the alias was declared in, or `s` in one function would credit `s` in
     * every other.
     */
    const { readdir } = await import('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u, prefix + e.name + '/');
        else if (e.name.endsWith('.js')) files.push([prefix + e.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(src(''), '');

    // Comments and string literals go first. `'saber.settings.v4'` is a
    // localStorage key, not a read, and the notes in this repo talk about
    // settings by name constantly.
    const strip = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    /** From `at` forward to the end of the block that encloses it. */
    const restOfBlock = (code, at) => {
      let depth = 0;
      for (let i = at; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { if (depth === 0) return code.slice(at, i); depth--; }
      }
      return code.slice(at);
    };

    const readAt = new Map();
    const note = (key, where) => {
      if (!readAt.has(key)) readAt.set(key, new Set());
      readAt.get(key).add(where);
    };
    for (const [path, raw] of files) {
      const code = strip(raw);
      for (const m of code.matchAll(/\bsettings\??\.([A-Za-z_$][\w$]*)/g)) note(m[1], path);
      /* ── AN ALIAS OF THE SETTINGS OBJECT, AND NOT OF ONE SETTING ────────
       *
       * This catches `const s = world.settings;` so that `s.foo` counts as
       * reading `foo`. It also caught `const v = settings?.keepsakes;` — a
       * setting's VALUE, not the object — and then read the array's own
       * `v.filter(...)` as a setting called `filter`, which the clause below
       * duly reported as "read by shipped code and defaulted nowhere". An
       * instrument that invents a setting is worse than one that misses a
       * reader. The lookahead refuses a property access on `settings` itself.
       */
      for (const m of code.matchAll(
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.?]*\.)?settings(?!\s*\??[.[])\s*(?:\|\||\?\?)?[^;\n]*;/g)) {
        const scope = restOfBlock(code, m.index + m[0].length);
        for (const u of scope.matchAll(new RegExp(`\\b${m[1]}\\??\\.([A-Za-z_$][\\w$]*)`, 'g'))) note(u[1], path);
      }
    }

    /**
     * THE ONE DECLARED EXCEPTION, and it is a scope and not an excuse.
     *
     * A duel's rules arrive in the HOST'S SESSION BLOB, not in the player's
     * save: `worldSettings()` spreads `session` over `settings`, and the note
     * over `session` in main.js is explicit that a session is a different scope
     * from a preference — writing one of these into DEFAULT_SETTINGS would put
     * somebody else's match rules into your own persisted file, which is the
     * bug that note exists to record. `pvpRules({})` returns co-op's rules for
     * every one of them by design, so a missing key here is an answer and not a
     * hole. Held to a standard anyway: each must still be genuinely read, so
     * this list cannot rot into a place to put things.
     */
    /* `pvp` IS BOTH NOW, and that is not a contradiction. It has a control and
     * a DEFAULT_SETTINGS key — a solo player can turn a free duel on — AND it
     * rides the host's session blob (`Net.SESSION_KEYS`), because in a session
     * the match's rules are the host's. The four `duel*` keys stay session-only:
     * they are read exclusively inside `DuelMatch`, which only the host builds,
     * so a client never asks and a default would be a number nobody consults.
     * The clause below holds every name here to being genuinely read, so this
     * list cannot rot into a place to put things. */
    const SESSION_ONLY = ['pvp', 'duelRounds', 'duelHealth', 'duelRoundTime', 'duelBoons'];
    const stale = SESSION_ONLY.filter(k => !readAt.has(k));
    assert(!stale.length,
      `declared session-scoped and read by nothing: ${stale.join(', ')} — the exemption list is rotting`);

    const orphan = [...readAt.keys()]
      .filter(k => !(k in DEFAULT_SETTINGS) && !SESSION_ONLY.includes(k))
      .sort();
    assert(!orphan.length,
      `read by shipped code and defaulted nowhere: `
      + orphan.map(k => `${k} (${[...readAt.get(k)].join(', ')})`).join('; ')
      + ' — a setting with no default is invisible to every other check in this file, '
      + 'so it needs no reader declaration and no control and nothing complains');

    // …and the four this check was written for really are settled now.
    for (const key of ['teamDamage', 'commandFormation', 'instantSpawn', 'maxBodies']) {
      assert(key in DEFAULT_SETTINGS, `${key} has a reader in src/ and no default again`);
      assert(readAt.has(key), `nothing in src/ reads ${key} any more — the setting is dead`);
    }
    return `${readAt.size} settings read across ${files.length} files: `
      + `${readAt.size - SESSION_ONLY.length} defaulted, ${SESSION_ONLY.length} session-scoped, 0 orphaned`;
  });

  check('controls: every setting in DEFAULT_SETTINGS is read by named code', async () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    const listed = Object.keys(SETTING_READERS);
    const unlisted = keys.filter(k => !listed.includes(k));
    assert(!unlisted.length,
      `no reader declared for: ${unlisted.join(', ')} — a setting that does nothing is a lie to the player`);
    const stale = listed.filter(k => !keys.includes(k));
    assert(!stale.length, `SETTING_READERS names settings that no longer exist: ${stale.join(', ')}`);

    // And the declaration has to be TRUE: the named file must contain the named
    // expression, and the expression must actually mention the setting.
    //
    // The table itself is cut out of whatever file it is searched in first, and
    // that is not a detail. The manifest lives in Menu.js and two entries point
    // back at Menu.js, so a plain substring search over that file is satisfied
    // by the entry's own text: delete the gate and the check still passes. Left
    // in, this check would have been exactly the kind of thing it exists to
    // catch — reads correctly, proves nothing.
    const strip = (text) => {
      const a = text.indexOf('export const SETTING_READERS = {');
      if (a < 0) return text;
      const b = text.indexOf('\n};', a);
      return b < 0 ? text.slice(0, a) : text.slice(0, a) + text.slice(b);
    };
    const cache = new Map();
    const missing = [];
    for (const [key, [file, expr]] of Object.entries(SETTING_READERS)) {
      assert(expr.includes(key), `the reader declared for ${key} does not mention it: ${expr}`);
      if (!cache.has(file)) cache.set(file, await readFile(src(file), 'utf8').then(strip, () => null));
      const text = cache.get(file);
      if (text === null) { missing.push(`${key} → ${file} does not exist`); continue; }
      if (!text.includes(expr)) missing.push(`${key} → ${file} no longer contains \`${expr}\``);
    }
    assert(!missing.length, missing.join('; '));
    return `${keys.length} settings, ${new Set(listed.map(k => SETTING_READERS[k][0])).size} reader files, all verified`;
  });

  check('controls: every control in the menu is bound to a setting', async () => {
    // The other half of the same lie. A setting with no reader does nothing;
    // a CONTROL with no setting does nothing either, and _slider and _check
    // both return quietly when the element they were given is not there — so a
    // renamed id in index.html silently unbinds a slider with no error at all.
    const html = await read('index.play.html');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const ids = new Set([
      ...[...html.matchAll(/id="(opt-[a-z0-9-]+)"/g)].map(m => m[1]),
      ...[...menu.matchAll(/id="(opt-[a-z0-9-]+)"/g)].map(m => m[1]),   // built in JS
    ]);
    const bound = [...menu.matchAll(/_(?:slider|check)\('(opt-[a-z0-9-]+)',\s*'([A-Za-z0-9_]+)'/g)]
      .map(m => [m[1], m[2]]);
    // The pickers (scheme, quality, deflect aim, opponent) are not one input
    // each, so they are looked up by id and write their setting by hand.
    const custom = new Set([
      ...[...menu.matchAll(/getElementById\('(opt-[a-z0-9-]+)'\)/g)].map(m => m[1]),
      ...[...menu.matchAll(/querySelector\('#(opt-[a-z0-9-]+)'\)/g)].map(m => m[1]),
    ]);

    const wired = new Set([...bound.map(([, key]) => key), 'sandboxType', 'sandboxMix',
      'versusWin', 'versusTeams', 'scheme', 'quality', 'deflectAim', 'unlimitedBlade']);
    const orphan = [...ids].filter(id => !bound.some(([bid]) => bid === id) && !custom.has(id));
    assert(!orphan.length, `controls bound to nothing: ${orphan.join(', ')}`);

    const ghosts = bound.filter(([id]) => !ids.has(id)).map(([id, key]) => `${id} (${key})`);
    assert(!ghosts.length,
      `bound to an element that does not exist — _slider/_check return silently: ${ghosts.join(', ')}`);

    const unknown = bound.map(b => b[1]).filter(k => !(k in DEFAULT_SETTINGS));
    assert(!unknown.length, `controls writing settings that have no default: ${unknown.join(', ')}`);
    // and the two that started this: their box must exist AND carry a hook
    for (const [id, key] of [['opt-shake', 'shake'], ['opt-slowmo', 'slowmo']]) {
      assert(html.includes(`id="${id}"`), `${id} is gone from the options screen`);
      const re = new RegExp(`_check\\('${id}',\\s*'${key}',\\s*[^)]`);
      assert(re.test(menu), `${id} is bound to ${key} with no onChange — that is how it died the first time`);
    }
    return `${ids.size} controls, ${bound.length} slider/checkbox bindings + ${custom.size} pickers, ${wired.size} settings written`;
  });

  check('controls: every boon changes the player, and every change has a reader', async () => {
    // A REAL Player prototype, not a bag of fields. A boon whose effect is a
    // technique rather than a number has nothing to install on a plain object,
    // and would read as "changes nothing" against one — which is how a card
    // that lies passes a test that only inspects numbers.
    const base = () => {
      const p = thrower(targetsWorld(0));
      p.boonMods.absorb = false;
      Object.assign(p, { maxHp: 100, hp: 100, maxStamina: 100, stamina: 100 });
      p.control.deadzone = 0.24;
      p.control.sensitivity = 1;
      return p;
    };

    /**
     * EVERY SOURCE FILE, minus the BOONS table itself: a boon that "reads" its
     * own flag only where it writes it is exactly the bug being fenced off
     * here, and that exclusion is the whole point of the word "elsewhere".
     *
     * The five files this used to name by hand were the five that happened to
     * read a boon when it was written, and a hand-written list of readers goes
     * stale the first time a boon is answered somewhere new — which it did:
     * the six the line modes shipped are read in `Command.js` and `Enemy.js`,
     * and this check called all six a lie. Walking `src/` cannot go stale, and
     * it is strictly stronger: every file the old list named is still in it.
     */
    const waves = await readFile(src('game/Waves.js'), 'utf8');
    const walk = async (dir) => {
      const out = [];
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const at = new URL(ent.name + (ent.isDirectory() ? '/' : ''), dir);
        if (ent.isDirectory()) out.push(...await walk(at));
        else if (ent.name.endsWith('.js') && ent.name !== 'Waves.js') out.push(at);
      }
      return out;
    };
    const files = await walk(src(''));
    const elsewhere = [
      waves.slice(0, waves.indexOf('export const BOONS = [')),
      ...await Promise.all(files.map((f) => readFile(f, 'utf8'))),
    ].join('\n');

    /**
     * What a key is worth when a boon has NOT set it — the `?? x` the reader
     * falls back to. Makashi's disease: World reads
     * `boonMods.riposteWindow ?? 1` and the card's "ripostes last twice as
     * long" set it to 1.0. The identity. The field changed, the window did not,
     * and every check that only diffs fields went green.
     */
    const fallback = (k) => {
      const m = elsewhere.match(new RegExp(`boonMods\\??\\.${k}\\s*\\?\\?\\s*(-?[0-9.]+)`));
      return m ? parseFloat(m[1]) : undefined;
    };

    const inert = [], unread = [], identity = [];
    for (const b of BOONS) {
      const before = base(), after = base();
      b.apply(after);
      const touched = modsMoved(after.boonMods, before.boonMods);
      // Numbers are the easy half. A boon whose effect is a TECHNIQUE leaves no
      // number behind at all — it installs something on the instance — so an
      // own-key diff has to count too, or the one boon that was a lie would be
      // the one boon this check could not see.
      const was = new Set(Object.keys(before));
      const other = Object.keys(after).some(k => !was.has(k))
        || [...was].some(k => typeof before[k] !== 'object' && after[k] !== before[k])
        || after.control.deadzone !== before.control.deadzone
        || after.control.sensitivity !== before.control.sensitivity
        || after.saber.bladeLength !== before.saber.bladeLength
        || after.saber.coreWidth !== before.saber.coreWidth;
      if (!touched.length && !other) inert.push(b.id);
      for (const k of touched) {
        const re = new RegExp(`boonMods\\??\\.${k}\\b`);
        if (!re.test(elsewhere)) unread.push(`${b.id} → boonMods.${k}`);
        if (before.boonMods[k] === undefined) {
          const fb = fallback(k);
          if (fb !== undefined && after.boonMods[k] === fb) {
            identity.push(`${b.id} → boonMods.${k} = ${fb}, which is what the reader already assumes`);
          }
        }
      }
    }
    assert(!inert.length, `boons that change nothing at all: ${inert.join(', ')}`);
    assert(!unread.length,
      `boonMods nothing outside the boon table reads: ${unread.join(', ')} — the card promises what the code never does`);
    assert(!identity.length, `boons written to their own identity value: ${identity.join('; ')}`);
    return `${BOONS.length} boons, all change the player, all changes read elsewhere, none written to identity`;
  });

  check('controls: Cleaving Throw is wired to a seam that still exists', () => {
    // The technique wraps Player._updateThrow, which is the only seam the throw
    // has. Rename it in Player.js and this fails, instead of the boon silently
    // going back to being a card that lies.
    assert(typeof Player.prototype._updateThrow === 'function',
      'Player._updateThrow is gone — Cleaving Throw has nothing to wrap');
    // Through apply(), which is what the draft screen calls — not through
    // cleavingThrow directly. A boon that stops CALLING its own technique is
    // exactly as dead as one that never had it.
    const p = thrower(targetsWorld(0));
    const stock = p._updateThrow;
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    assert(p._updateThrow !== stock, 'taking the card changed nothing about the throw');
    assert(p.boonMods.throwPierce === true, 'the card reports itself dead after being taken');
    const q = thrower(targetsWorld(0));
    assert(cleavingThrow(q) === true, 'the technique refused to install on a real Player');
    // and it declines cleanly on something that is not a player, rather than
    // pretending it worked
    assert(cleavingThrow({}) === false, 'the technique claimed to install on an object with no throw');
    return `wrapped ${Player.prototype._updateThrow.name || '_updateThrow'}, recall ×${CLEAVE.recall}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Residue: one value, two homes                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: no player-facing surface types a key name', async () => {
    // The residue of the rebind that moved Hurl off Mouse2 — where it had
    // shipped colliding with Thrust — onto Y. main.js was taught to print the
    // coach panel's legend from the bindings; the Codex grid, seventeen rows of
    // markup in index.html, was not. Sixteen of those rows agreed with
    // defaultBindings(); the seventeenth told a player on a fresh profile
    // "M2 to hurl it", and M2 thrusts. A typed key cannot follow a rebind, so
    // the rule is that no key name is typed at all.
    const html = await read('index.play.html');
    const typed = [...html.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1]);
    assert(!typed.length,
      `index.html types ${typed.length} key names into the markup (${typed.join(', ')}) — `
      + 'markup cannot read the bindings table');
    for (const id of ['codex-grid', 'pause-hints']) {
      assert(html.includes(`id="${id}"`), `#${id} is gone, so nothing can fill it from the bindings`);
    }

    // The exact row, stated as arithmetic against the shipped table.
    const b = defaultBindings();

    /**
     * AND THE ONE THAT WAS NOT IN A `<kbd>`.
     *
     * The sweep above matches `<kbd>` because that is the tag every legend in
     * this product uses — and the kneel prompt did not use it. `<b
     * id="commune-key">Ctrl</b>` sat in the markup carrying `crouch`'s default,
     * overwritten by main.js's `liveKey('crouch')` on the frame the prompt is
     * raised, so the typed word was invisible in a working build and would have
     * been a wrong key in any build where that write did not happen. Same class
     * of defect as the Codex's "M2 to hurl it", one tag along.
     *
     * The bar is that whatever ships in it is not a key name: `—` is what
     * `keyChips` prints for an action bound to nothing, and an empty element is
     * equally honest. Checked against EVERY label the table can produce rather
     * than against the word "Ctrl", so re-typing a different default fails too.
     */
    const seeded = html.match(/id="commune-key"[^>]*>([^<]*)</);
    assert(seeded, '#commune-key is gone, so nothing can name the kneel from the bindings');
    const labels = new Set(ACTION_IDS.flatMap((id) => (b[id] || []).map((c) => keyLabel(c))));
    assert(!labels.has(seeded[1].trim()),
      `the kneel prompt ships with "${seeded[1].trim()}" typed into it — markup cannot follow a rebind`);
    const rowOf = (markup, re) =>
      [...markup.matchAll(/<div>([\s\S]*?)<span>([\s\S]*?)<\/span><\/div>/g)].find(r => re.test(r[2]));
    const chips = (s) => [...s.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1]);
    const grip = rowOf(codexHtml(b), /Grip an object/);
    assert(grip, 'the Codex no longer has a row about gripping an object');
    const inline = chips(grip[2]);
    assert(inline.length === 1 && inline[0] === keyLabel(b.hurl[0]),
      `the grip row says ${inline.join('/') || 'nothing'} hurls, and hurl answers to `
      + `${b.hurl.map(keyLabel).join('+')}`);
    /* THE SENTINEL, and it is derived rather than named. What made the typed
     * row a lie was that Mouse2 belongs to SOMETHING ELSE — it does not matter
     * which action, and naming one meant this check went red the day the
     * mouse buttons were swapped (RMB guards, LMB attacks) even though the
     * rule it protects had not moved an inch. */
    const holder = ACTION_IDS.find(id => id !== 'hurl' && (b[id] || []).includes('Mouse2'));
    assert(holder && !b.hurl.includes('Mouse2'),
      holder ? 'hurl answers to Mouse2 again, so the Codex row this check exists for is honest '
        + 'and the check is measuring nothing'
        : 'nothing but hurl claims Mouse2 any more, so a typed "M2 to hurl it" would be TRUE '
        + 'and this check would pass for the wrong reason');

    // EVERY action, and by REBINDING rather than by reading a declaration:
    // move one action onto a key nothing else uses, re-render, and the Codex
    // has to start saying so. An action the Codex never mentions cannot pass,
    // and neither can a row that prints a name instead of a binding — which is
    // the only way this can be satisfied by typing, and it cannot.
    const PROBE = 'F13';
    const silent = [];
    for (const id of ACTION_IDS) {
      const probe = defaultBindings();
      probe[id] = [PROBE];
      if (!new RegExp(`<kbd>(?:Hold )?${PROBE}</kbd>`).test(codexHtml(probe))) silent.push(id);
    }
    assert(!silent.length,
      `the Codex never prints the live binding for: ${silent.join(', ')} — either the action is `
      + 'documented nowhere a player reads, or the row prints a typed name');
    // Named because they are the two that were invented and then documented
    // nowhere at all, and a generic message would not say so.
    for (const id of ['stance', 'flourish']) {
      assert(ACTION_IDS.includes(id) && !silent.includes(id),
        `${id} exists as a binding and appears on no screen the player reads`);
    }
    // The pause card is the same surface with two rebindable keys on it.
    for (const id of ['view', 'scoreboard']) {
      const probe = defaultBindings();
      probe[id] = [PROBE];
      assert(pauseHintsHtml(probe).includes(`<kbd>${PROBE}</kbd>`),
        `the pause card prints a typed key for ${id}`);
    }
    // A row may only name actions that exist; a renamed id must fail loudly
    // rather than render a dash.
    const ghosts = CODEX.flatMap(r => r.keys || []).filter(id => !ACTION_IDS.includes(id));
    assert(!ghosts.length, `the Codex names actions that are not in the table: ${ghosts.join(', ')}`);

    // The other direction, and the one that closes the hole the probe above
    // leaves: a row could still TYPE "M2" into its prose while some other row
    // printed thrust's real binding, and every assertion so far would pass. So
    // bind every action to a code of its own, render once, and require that
    // every <kbd> on the page came out of the table. The only survivors are the
    // declared literals — the mouse's own motion, which is not a binding, and
    // Esc, which main.js handles raw so that pausing survives a broken one.
    const all = defaultBindings();
    ACTION_IDS.forEach((id, i) => { all[id] = [`PROBE${i}`]; });
    const mint = new Set(ACTION_IDS.map((_, i) => `PROBE${i}`));
    const strays = chips(codexHtml(all)).map(t => t.replace(/^Hold /, ''))
      .filter(t => !mint.has(t) && t !== 'Mouse');
    assert(!strays.length,
      `key names in the Codex that did not come from the bindings table: ${[...new Set(strays)].join(', ')}`);
    const pauseStrays = chips(pauseHintsHtml(all)).map(t => t.replace(/^Hold /, ''))
      .filter(t => !mint.has(t) && t !== 'Esc');
    assert(!pauseStrays.length,
      `key names on the pause card that did not come from the table: ${[...new Set(pauseStrays)].join(', ')}`);
    // The control-scheme cards, which named Mouse2's default as "RMB" while
    // describing what is really `!input.act('thrust')`.
    const schemeStrays = SCHEMES.flatMap(s => chips(s.blurb(id => keyChips(all, id))))
      .filter(t => !mint.has(t));
    assert(!schemeStrays.length,
      `key names on the control-scheme cards that did not come from the table: ${[...new Set(schemeStrays)].join(', ')}`);
    for (const s of SCHEMES) {
      assert(/<kbd>/.test(s.blurb(id => keyChips(b, id))),
        `the ${s.name} card describes a control and names no key at all`);
    }
    // And the boon cards are a player-facing surface too: "Unlocks lightning on
    // Z" was a key name typed into a run reward.
    const named = BOONS.filter(x =>
      /\b(?:on|press|pressing|hold|holding|with) [A-Z0-9]\b|\bM[1-5]\b|\bMouse ?[1-5]\b/.test(x.text));
    assert(!named.length, `boon cards that type a key name: ${named.map(x => x.id).join(', ')}`);
    return `${CODEX.length} rows, ${ACTION_IDS.length}/${ACTION_IDS.length} actions printed from the table, `
      + `0 typed <kbd> in index.html; grip row prints ${inline[0]} and hurl is ${b.hurl.map(keyLabel).join('+')}`;
  });

  check('controls: Focusing Crystal reaches the blade, not just a field on it', () => {
    // `p.saber.coreWidth *= 1.25` moved a number that only the Saber
    // CONSTRUCTOR had ever read — uWidth/uRadius in _buildBlade, trailThickness
    // in _buildTrail — so on a blade already in the player's hand the card's
    // three promises came to one. Measured, not asserted: the uniforms, and
    // then the thing the uniforms are supposed to be for, which is the geometry
    // that actually gets drawn.
    const cam = new THREE.PerspectiveCamera();
    const s = new Saber(new THREE.Scene(), { coreWidth: 1 });
    s.ignite(); s.ignition = 1;
    const swing = (n) => {
      for (let i = 0; i < n; i++) {
        s.root.rotation.z = Math.sin(i * 0.4) * 1.2;
        s.root.updateMatrixWorld(true);
        s.update(1 / 60, { camera: cam });
      }
    };
    /**
     * The DRAWN channel. The uniform moving is not the same claim as the smear
     * getting wider: _updateTrail offsets sheet k by `(k - 1) * trailThickness`
     * along the sweep normal, so the distance between the outer two sheets is
     * the slab a player can see. A check that only read the field would pass on
     * a build where nothing consumed it — which is the bug being fixed.
     */
    const drawnSlab = () => {
      const p = s.trailPos;
      let max = 0;
      for (let i = 0; i < s.trailSegments; i++) {
        const a = (i * s.trailSheets) * 2 * 3;
        const c = (i * s.trailSheets + s.trailSheets - 1) * 2 * 3;
        const d = Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2]);
        if (d > max) max = d;
      }
      return max / 2;
    };
    swing(30);
    const before = {
      w: s.bladeMat.uniforms.uWidth.value.clone(),
      r: s.bladeMat.uniforms.uRadius.value,
      t: s.trailThickness,
      slab: drawnSlab(),
    };
    assert(before.slab > 1e-4, 'the trail drew nothing, so the drawn channel is not being measured');

    // Through the card, the way the draft screen takes it.
    BOONS.find(x => x.id === 'dualcrystal').apply({ saber: s, boonMods: { cutPower: 1 } });
    swing(60);
    const after = {
      w: s.bladeMat.uniforms.uWidth.value.clone(),
      r: s.bladeMat.uniforms.uRadius.value,
      t: s.trailThickness,
      slab: drawnSlab(),
    };
    const k = 1.25;
    for (const [name, a, b0] of [['uWidth.x', after.w.x, before.w.x], ['uWidth.y', after.w.y, before.w.y],
      ['uWidth.z', after.w.z, before.w.z], ['uRadius', after.r, before.r],
      ['trailThickness', after.t, before.t], ['drawn slab', after.slab, before.slab]]) {
      assert(Math.abs(a / b0 - k) < 0.001,
        `${name} went ${b0.toFixed(5)} → ${a.toFixed(5)} (${(a / b0).toFixed(3)}×), and the card is worth ${k}×`);
    }
    // Both directions: a width that only ever grows is a latch, not a setting,
    // and the forge slider drives the same accessor downwards.
    s.coreWidth = 1;
    assert(Math.abs(s.bladeMat.uniforms.uRadius.value - before.r) < 1e-9,
      'putting the width back did not put the uniform back');
    // The forge builds a fresh Saber per drag, so construction must still land.
    const wide = new Saber(new THREE.Scene(), { coreWidth: 1.6 });
    assert(Math.abs(wide.bladeMat.uniforms.uRadius.value - Saber.PROFILE.radius * 1.6) < 1e-9,
      'opts.coreWidth no longer reaches the uniforms at construction');

    // The general rule, so the next boon to write a number onto the blade
    // cannot land in a field nobody reads: any boon that moves a saber field
    // has to move something the blade DRAWS.
    const dead = [];
    for (const boon of BOONS) {
      const t = new Saber(new THREE.Scene(), {});
      t.ignite(); t.ignition = 1;
      for (let i = 0; i < 20; i++) t.update(1 / 60, { camera: cam });
      const fields = () => `${t.bladeLength}/${t.coreWidth}`;
      const drawn = () => `${t.bladeMat.uniforms.uWidth.value.toArray().join(',')}|`
        + `${t.bladeMat.uniforms.uRadius.value}|${t.bladeMat.uniforms.uLen.value}|${t.trailThickness}`;
      const f0 = fields(), d0 = drawn();
      boon.apply({
        saber: t, control: {}, maxHp: 100, hp: 100,
        boonMods: new Proxy({}, { get: (o, key) => (key in o ? o[key] : 1), set: (o, key, v) => (o[key] = v, true) }),
      });
      for (let i = 0; i < 60; i++) t.update(1 / 60, { camera: cam });
      if (fields() !== f0 && drawn() === d0) dead.push(boon.id);
    }
    assert(!dead.length,
      `boons that write a number onto the blade and change nothing it draws: ${dead.join(', ')}`);
    return `uWidth ${before.w.y.toFixed(4)}→${after.w.y.toFixed(4)}, uRadius ${before.r.toFixed(3)}→${after.r.toFixed(3)}, `
      + `drawn slab ${before.slab.toFixed(4)}→${after.slab.toFixed(4)} m (all 1.250×)`;
  });

  check('controls: every setting has a control, not only a reader', async () => {
    // The other direction of "every control is bound to a setting", and the one
    // that was never asserted. `grassScale` and `particleScale` were keys of
    // DEFAULT_SETTINGS with real readers in World.loadLevel, no opt- id in
    // index.html and no _slider anywhere — pinned at 1 forever, while World's
    // own comment described "the player's own two sliders". `bladeHold` was the
    // same lie facing the other way: World.spawnPlayer read
    // `this.settings.bladeHold` into a per-frame controller flag and there was
    // no such setting and no such box.
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const html = await read('index.play.html');
    const bound = new Map([...menu.matchAll(/_(?:slider|check)\('(opt-[a-z0-9-]+)',\s*'([A-Za-z0-9_]+)'/g)]
      .map(m => [m[2], m[1]]));
    /**
     * The settings that are PICKED rather than slid — cards, swatches and
     * radio lists, one element per option. Not a free pass: each one still has
     * to be written by hand somewhere in this file, which is asserted below, so
     * a setting cannot join this list without a control writing it.
     */
    const PICKED = ['level', 'difficulty', 'mode', 'colorIndex', 'hiltStyle', 'robeIndex',
      'sandboxType', 'scheme', 'quality', 'deflectAim', 'holocron',
      /* `sandboxMix` and `unlimitedBlade` used to be here, as a stepper per
       * archetype and a tick box on the Training tab. Both are PROGRAMMED
       * now — see the derivation below. `sandboxType` stays: the pause card's
       * Opponent select still writes it, and it is what the bodies you did NOT
       * name are, so the two were always a pair rather than a duplicate. */
      /* The Commander Battle's two picked settings. `versusWin` is a card row
       * built off `VERSUS_WINS`, like every other list on this screen;
       * `versusTeams` is the session roster with a side on each name, written
       * a name at a time. Both are `this.s.<key> =` at their control site,
       * which is what this list is asking for. The other two — the strength
       * and the reinforcement interval — are sliders and are in `bound`. */
      'versusWin', 'versusTeams',
      'skinIndex', 'hairIndex', 'order', 'species', 'face', 'robeCut',
      // a swatch row under the crystals, same shape as colorIndex's
      'lightningColor',
      // The rest of the clothes — nine cut and tone rows writing into one
      // object, the way `face` is one object, and written by `_wear`.
      'wardrobe',
      // Synthesised / spoken / both, on a card row of its own.
      'speechMode',
      // The standing order, as six cards built straight from FORMATIONS — the
      // formation records ARE the card list, so the row cannot fall out of step
      // with the orders on the keyboard.
      'commandFormation',
      // The run rules — a card per entry of Waves.CONDITIONS, on the Deploy
      // panel, toggled rather than selected. Same shape as the mode list and
      // held to the same standard: `_syncRules` writes `this.s.rules` by name,
      // which is what the regex below is checking for.
      'rules',
      // Whose name is over whose head — a row of cards on the Interface
      // panel, written by `_pick('troopNames', …)` like every other picker.
      'troopNames',
      // The meditation pose — a card row off Rig.MEDITATION_POSES under the
      // robe cut, read by main.js's commune. See DEFAULT_SETTINGS.meditation.
      'meditation',
      /* WHICH WEAPON YOU CARRY — a card row off `SABER_SETS` beside the
       * blade's own colour, length and hilt, in the same `_cardRow` shape the
       * robe cut and the meditation pose use. It is on the Jedi tab and not
       * under Gameplay because it is a fact about your character rather than a
       * rule of the match, which is the same reading `Net.LOOK_KEYS` takes of
       * it. `this.s.saberSet` is written at the control site, which is what
       * the regex below is asking for. */
      'saberSet',
      /* WHICH COMPANION COMES WITH YOU — a card row built off COMPANION_ORDER
       * with a real NONE row at its head, in the same `_cardRow` shape as the
       * robe cut and the saber set. `this.s.companion` is written at the
       * control site, which is what the regex below is asking for. */
      'companion'];
    /**
     * The settings that are TYPED — a text box rather than a slider, a
     * checkbox or a row of cards. One so far: the co-op name, which is the
     * only setting in the game whose value is a word the player invents.
     * Held to the same standard as the rest — the id has to be in the markup
     * and the menu has to write the key by name — so this is a third shape of
     * control, not a third way to be excused from having one.
     */
    const TYPED = { playerName: 'opt-name', seed: 'opt-seed' };
    /**
     * THE ONE SETTING EXCUSED FROM HAVING A CONTROL, AND THE EXCUSE IS DERIVED
     * RATHER THAN ASSERTED.
     *
     * `grassScale` is read — `World.loadLevel` plants
     * `density: (settings.grassScale ?? 1) * L.grass` — but nine of nine levels
     * author `grass: 0`, so the product is zero whatever a slider says. The row
     * on the options screen was a live control with nothing at the other end of
     * it, which is the defect this whole file is about, so it is gone. The
     * multiplier stays because the machinery is real and proved elsewhere.
     *
     * The exemption lasts exactly as long as its reason: the day a level grows
     * a field, `covered` is non-empty, `grassScale` is an orphan again, and
     * this check asks for the slider back by name. Nothing here is on a list a
     * reader has to maintain.
     */
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const covered = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].grass > 0);
    const EXCUSED = covered.length ? {} : {
      grassScale: 'no level grows a field, so the slider could not move anything — see Menu.js',
    };
    /**
     * ══ A FOURTH SHAPE OF CONTROL: PROGRAMMED (V16 §A2) ═══════════════════
     *
     * *"a holodeck/dojo that replaces the training and sandbox menus — you
     * walk into a room and program it rather than picking a tab."*
     *
     * Four settings are now moved by a thing that is not on the menu at all:
     * a PROGRAM, chosen off the rack in `#57 The Repeating Room`. This check
     * asks "can the player move it", and it was answering that question by
     * looking only in `Menu.js` — which was a complete list of the ways a
     * setting could be written right up until the moment it was not.
     *
     * DERIVED, LIKE `EXCUSED` AND UNLIKE A LIST. A key is programmed if some
     * program's `programSettings` output actually DIFFERS from the default for
     * it. So a setting cannot join this by being typed here: it joins by a
     * program moving it, and it falls off the day the last program that moves
     * it stops — at which point the key is an orphan again and this check asks
     * for a control back by name. The room is held to the same standard as the
     * markup.
     */
    const { programs, programSettings } = await import('../../src/game/Holodeck.js');
    const { LESSONS } = await import('../../src/game/Dojo.js');
    const PROGRAMMED = new Set();
    for (const prog of programs(LESSONS)) {
      const out = programSettings(prog, DEFAULT_SETTINGS);
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (JSON.stringify(out[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])) PROGRAMMED.add(k);
      }
    }
    /**
     * ══ A FIFTH SHAPE OF CONTROL: BOUGHT (V16 §B) ═════════════════════════
     *
     * *"maybe cosmetic stuff you buy is permanent."* A keepsake is moved at a
     * counter, by spending credits — which is a control the player operates
     * with their hands, and is not on the menu and must never be: a slider
     * that granted a 3200-credit beskar plate would make the shop a decoration.
     *
     * DERIVED, LIKE `PROGRAMMED` AND UNLIKE A LIST, and for the identical
     * reason: a key joins by a PURCHASE actually writing it, and falls off the
     * day the last row that writes it goes — at which point it is an orphan
     * again and this check asks for a control back by name. Every keepsake on
     * every counter is bought against a copy of the defaults, and whatever
     * moved is what the shop can move.
     */
    const K = await import('../../src/game/Keepsakes.js');
    const V = await import('../../src/game/Vendors.js');
    const BOUGHT = new Set();
    for (const row of V.everyRow()) {
      if (row.kind !== 'keepsake') continue;
      const before = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const after = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      try { K.takeKeepsake(after, row); } catch { continue; }
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) BOUGHT.add(k);
      }
      /* The ledger itself is written on every purchase and is not a field of
       * the defaults' own shape until one lands, so it is named off the store
       * rather than diffed. */
      if (after.keepsakes && after.keepsakes.length) BOUGHT.add('keepsakes');
    }
    const orphans = [], ghost = [], programmed = [], bought = [];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (EXCUSED[key] && !bound.has(key)) continue;
      if (TYPED[key]) {
        assert(html.includes(`id="${TYPED[key]}"`), `#${TYPED[key]} is in no markup, so ${key} has no field`);
        assert(new RegExp(`this\\.s\\.${key}\\s*=`).test(menu), `nothing in the menu writes ${key}`);
        continue;
      }
      if (bound.has(key)) {
        assert(html.includes(`id="${bound.get(key)}"`) || menu.includes(`id="${bound.get(key)}"`),
          `${key} is bound to #${bound.get(key)}, which is in no markup — _slider returns silently`);
        continue;
      }
      if (!PICKED.includes(key)) {
        /* AFTER the pickers, so a setting that has BOTH a card and a program
         * is still held to having the card. The room is the last resort, not
         * an amnesty. */
        if (PROGRAMMED.has(key)) { programmed.push(key); continue; }
        if (BOUGHT.has(key)) { bought.push(key); continue; }
        orphans.push(key);
        continue;
      }
      // `_swatchRow('skin-list', 'skinIndex', ...)` names the key at the control
      // site just as explicitly as `this.s.skinIndex =` does — it is the same
      // guarantee through a shared helper, so the vocabulary widens and the
      // property does not: a setting still cannot reach this list without a
      // control that writes it BY NAME.
      const re = new RegExp(`this\\.s\\.${key}\\s*=|_set\\('${key}'|_swatchRow\\('[a-z-]+', '${key}'|_cardRow\\('[a-z-]+', '[a-z-]+', '${key}'|_pick\\('${key}'`);
      if (!re.test(menu)) ghost.push(key);
    }
    assert(!orphans.length,
      `settings with a reader and no control: ${orphans.join(', ')} — the player cannot move them, `
      + 'so they are pinned at their default forever');
    assert(!ghost.length, `listed as picked, but nothing in the menu writes them: ${ghost.join(', ')}`);
    /* AND THE ONES THIS CHECK WAS WRITTEN FOR. `grassScale` was the third and
     * is now the excused one above — it is asserted the other way round here,
     * so a slider that comes back without a level to feed it is caught too. */
    for (const key of Object.keys(EXCUSED)) {
      assert(!bound.has(key) && !html.includes('id="opt-grass"'),
        `${key} is excused from having a control because ${EXCUSED[key]}, and one is on screen anyway`);
    }
    for (const [key, id] of [['particleScale', 'opt-particles'], ['bladeHold', 'opt-bladehold']]) {
      assert(bound.get(key) === id, `${key} is bound to ${bound.get(key) || 'nothing'}, expected #${id}`);
      assert(html.includes(`id="${id}"`), `#${id} is not on the options screen`);
    }
    return `${Object.keys(DEFAULT_SETTINGS).length} settings: ${bound.size} on sliders/checkboxes, `
      + `${PICKED.length} on pickers, ${Object.keys(TYPED).length} typed, `
      + `${programmed.length} programmed in #57 (${programmed.join(', ') || '—'}), `
      + `${Object.keys(EXCUSED).length} excused (${Object.keys(EXCUSED).join(', ') || '—'}), 0 with no control`;
  });

  check('controls: the two fidelity sliders multiply the tier and bite mid-run', async () => {
    // A control that exists is not the same claim as a control that does
    // something. Driven through World.prototype.applyQuality — the real reader,
    // and the seam the slider's hook fires — with a real Particles pool.
    const scene = new THREE.Scene();
    const w = { settings: { quality: 'high', particleScale: 1 }, particles: new Particles(scene, QUALITY.high.particles),
      applyQuality: World.prototype.applyQuality };
    const pFull = w.particles.scale;
    w.settings.particleScale = 0.5;
    w.applyQuality('high');
    const pHalf = w.particles.scale;
    assert(Math.abs(pHalf / pFull - 0.5) < 1e-6,
      `halving the slider took emission from ${pFull} to ${pHalf}, not half of it`);
    // It must MULTIPLY the tier, not replace it: at the same slider position,
    // Performance has to stay under Cinematic.
    w.settings.particleScale = 1.5;
    w.applyQuality('low');
    const lowMax = w.particles.scale;
    w.applyQuality('ultra');
    const ultraMax = w.particles.scale;
    assert(lowMax < ultraMax,
      `Performance at 150% emits ${lowMax} and Cinematic at 150% emits ${ultraMax} — the slider is replacing the tier`);
    /**
     * THE GRASS SLIDER, THROUGH THE LEVEL LOAD THAT READS IT — and this was
     * the hole in this check.
     *
     * It read: "Grass is planted at level load, so the slider scales the
     * DENSITY the level asks for. Asserted on the expression, because the
     * field it feeds is an allocation and rebuilding it needs a level", and
     * then regexed `density: (this.settings.grassScale ?? 1) * L.grass` out of
     * World.js. A source match proves a line is WRITTEN. This check's own
     * opening sentence says that is not the claim — and rebuilding the field
     * needs a level, so the answer is to build one rather than to describe it.
     *
     * `World.loadLevel` is driven twice at two slider positions, and the
     * assertions are on `world.grass`, the field the game actually planted. No
     * arithmetic is restated here: if the product moves out of World.js, or
     * the `if (L.grass)` gate stops firing, or GrassField stops reading
     * `density`, this goes red (HANDOFF §2.4).
     */
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    await initPhysics();
    const stubEngine = () => {
      const sc = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.shadow.camera.updateProjectionMatrix();
      sc.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
      return { scene: sc, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
        sun, hemi: sc.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
        renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
        profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
        applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
        setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
        setQuality() {}, setResolutionScale() {}, render() {} };
    };
    /* ON A LEVEL THAT GROWS ONE, WHICH TODAY MEANS A LEVEL THIS CHECK PLANTS.
     * Nine of nine ship `grass: 0` — see the assertion below, which is the
     * other half of this — so the density the slider multiplies is zero and
     * loading the roster as it stands would measure the slider against
     * nothing, which is the defect. The level record is restored immediately;
     * `LEVEL_ORDER[0]`'s own ground and dressing are used unchanged. */
    const key = LEVEL_ORDER[0], L = LEVELS[key], was = L.grass;
    const planted = [];
    try {
      L.grass = 0.8;
      for (const grassScale of [1, 0.5]) {
        const w = new World(stubEngine(), { ...DEFAULT_SETTINGS, quality: 'high', grassScale });
        await w.loadLevel(key);
        assert(w.grass, `the slider at ${grassScale} planted no field at all on a level asking for ${L.grass}`);
        planted.push({ grassScale, density: w.grass.density, cover: w.grass.cover.amount });
        w.unload();
      }
    } finally { L.grass = was; }
    const [gFull, gHalf] = planted;
    assert(Math.abs(gHalf.density / gFull.density - 0.5) < 1e-6,
      `halving the grass slider took the planted density from ${gFull.density} to ${gHalf.density}`);
    assert(Math.abs(gFull.density - 0.8) < 1e-6,
      `at 100% the field was planted at ${gFull.density} against the level's own 0.8 — `
      + 'the slider is replacing the level rather than scaling it');
    assert(gHalf.cover < gFull.cover,
      `the ground is painted ${(gFull.cover * 100).toFixed(0)}% covered at 100% and `
      + `${(gHalf.cover * 100).toFixed(0)}% at 50% — the slider moves the blades and not the ground under them`);

    /**
     * AND THE HALF THE ARITHMETIC CANNOT ANSWER: does that product ever reach
     * a field in the SHIPPED game?
     *
     * It does not. `density` is `slider × L.grass`, and nine of nine levels
     * author `grass: 0`, so `World.loadLevel` never enters `if (L.grass)` and
     * `new GrassField` never runs — the control is live and visible on the
     * options screen and cannot move anything. That zero is a design call,
     * repeated by the player four times ("delete grass from any level whose
     * ground is snow, ice, sand or metal"; "get rid of the grass on drowned
     * wood completely"), and every ground the roster ships is snow, sand,
     * basalt, ash, red dust, bog or deck plate.
     *
     * So the two states are pinned against each other instead of one of them
     * being assumed. TODAY the slider is dead, which this says in its own pass
     * line rather than leaving silent — the patch that owes is `ui/Menu.js`
     * plus `index.html` (drop `opt-grass`/`grassScale`, or mark it dead), not
     * this file. THE DAY A LEVEL GROWS COVER this goes red, and what it asks
     * for is that the loop above be pointed at that level instead of planting
     * its own.
     */
    const covered = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].grass > 0);
    const dead = `no level grows a field (${LEVEL_ORDER.length} of ${LEVEL_ORDER.length} author grass: 0), `
      + 'so #opt-grass is a live control with nothing at the other end of it';
    assert(covered.length === 0,
      `${covered.join(', ')} now grow a cover field, so the grass slider finally reaches something in the `
      + 'shipped game — point the load above at that level and its own density, and drop this branch');
    const world = await readFile(src('game/World.js'), 'utf8');
    /* The DECLARATION KEYWORD is not part of the claim, and pinning it made
     * this red for a refactor that changed nothing it measures: World.js now
     * hoists `particleScale` to the top of loadLevel and assigns it lower down,
     * so `const particleScale = …` stopped matching while the two behavioural
     * assertions above — half the slider halves the emission, and Performance
     * at 150% still sits under Cinematic at 150% — went on passing. An
     * instrument that restates a line will eventually disagree with a line that
     * is still right (HANDOFF §2.4). What is asserted is the ARITHMETIC:
     * particleScale is the setting TIMES the tier, however it is declared. */
    assert(/particleScale\s*=\s*\(this\.settings\.particleScale \?\? 1\) \* q\.particles/.test(world),
      'particleScale no longer multiplies the tier');
    return `particles: slider 1.0→0.5 takes emission ${pFull.toFixed(2)}→${pHalf.toFixed(2)}, `
      + `at 1.5 low ${lowMax.toFixed(2)} < ultra ${ultraMax.toFixed(2)}; `
      + `grass: 1.0→0.5 plants density ${gFull.density}→${gHalf.density} and cover `
      + `${(gFull.cover * 100).toFixed(0)}%→${(gHalf.cover * 100).toFixed(0)}% — but ${dead}`;
  });

  check('controls: movement is read from the table and from nowhere else', () => {
    // Input.moveAxis carried `|| this.down('ArrowUp')` and three more like it.
    // That is a second set of movement bindings that ACTIONS never knew about,
    // so with the shipped defaults ArrowUp fired NO action, drove moveAxis.y to
    // 1, and findConflicts reported the key free. Bind anything to an arrow and
    // one press did two things, with no way for the options screen to warn —
    // the KeyB/KeyN bug, still alive underneath the fix for it.
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const b = defaultBindings();
    const hidden = [];
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6', 'KeyI', 'KeyK', 'KeyJ', 'KeyL']) {
      const i = fresh();
      i.keys.add(code); i.pressed.add(code);
      const acts = ACTION_IDS.filter(id => i.act(id) || i.actHit(id));
      const ax = i.moveAxis();
      const moves = ax.x !== 0 || ax.y !== 0;
      if (moves && !acts.length) hidden.push(`${code} → moveAxis(${ax.x},${ax.y}) with no action and no conflict`);
      if (!acts.length) {
        assert(!findConflicts(b, code).length,
          `${code} fires no action but findConflicts claims ${findConflicts(b, code).join('+')}`);
      }
    }
    assert(!hidden.length, `keys that move the player without being in the table: ${hidden.join('; ')}`);

    // The table still drives movement, and an arrow key is now an ORDINARY key
    // — bind it and it walks, and the conflict machinery can see it.
    const w = fresh();
    w.keys.add('KeyW');
    assert(w.moveAxis().y === 1, 'W no longer walks forward');
    const arrows = defaultBindings();
    arrows.moveF = ['KeyW', 'ArrowUp'];
    const a = fresh();
    a.setBindings(arrows);
    a.keys.add('ArrowUp');
    assert(a.moveAxis().y === 1, 'ArrowUp bound to moveF does not walk');
    assert(findConflicts(arrows, 'ArrowUp').join() === 'moveF',
      'a bound arrow key is invisible to findConflicts');
    // One press, one system: with push moved onto ArrowUp, the arrow must push
    // and NOT also walk.
    const clash = defaultBindings();
    clash.push = ['ArrowUp'];
    const c = fresh();
    c.setBindings(clash);
    c.keys.add('ArrowUp'); c.pressed.add('ArrowUp');
    assert(c.moveAxis().y === 0,
      'rebinding onto an arrow key still walks as well — the second binding is still there');
    return 'moveAxis reads moveF/moveB/moveL/moveR and the stick, nothing else; '
      + '4 arrows + 4 numpad + IJKL fire nothing and move nothing';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE CONTROLLER                                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: every action can be reached from a controller', () => {
    /**
     * MEASURED BEFORE THIS: NONE OF THEM COULD.
     *
     * `Input._codeDown` resolved a binding as a wheel pseudo-key, a `Mouse*`
     * button or `keys.has(code)` — there was no code form a pad button could
     * take, so no action in ACTIONS could be bound to one. What a pad reached
     * was the two sticks and buttons 4 and 5 (wrist roll, read raw inside
     * SaberController by INDEX, past this table). A player holding a controller
     * could not attack, guard, jump, dodge, dash, use a power, pause or open
     * the emote wheel.
     *
     * Stated as coverage of the WHOLE table rather than a list of the eight
     * verbs in that sentence, because a list is the thing that goes stale: a
     * 47th action added tomorrow fails here on the day it is written.
     */
    const b = defaultBindings();
    /**
     * …AND A WHEEL IS A CONTROLLER ROUTE. This is the one amendment the rule
     * has ever taken and it is derived, not an exception list.
     *
     * The six orders were each dealt a `Back`+button chord from a pool written
     * before the ORDER WHEEL existed. The wheel is on the pad, it is built from
     * `FORMATIONS` itself, and it carries every formation plus the hold toggle
     * — so those chords were a second complete route to the same six verbs, on
     * a pad that had filled all forty-six of its places and could not take a
     * spinning attack until something gave. The pool is retired (see
     * ORDER_PAD_POOL) and the wheel is what carries them.
     *
     * The exemption is CONDITIONAL and computed: an order is excused only while
     * `orderwheel` itself has a pad binding. Unbind the wheel and all six come
     * straight back into `missing`, which is what stops this from becoming the
     * hole the check exists to close.
     */
    const wheeled = (b.orderwheel || []).some(isPadCode)
      ? new Set(ORDER_ACTIONS.map(o => o.action)) : new Set();
    const missing = ACTION_IDS.filter(id => !wheeled.has(id) && !(b[id] || []).some(isPadCode));
    assert(!missing.length,
      `no pad binding at all for: ${missing.join(', ')} — a controller player cannot do these`);
    // The wheel's own claim, checked rather than trusted: every order it excuses
    // has to be an item ON it. `OrderWheel` builds its items from FORMATIONS, so
    // the two lists are the same list — this asserts they have not drifted.
    for (const o of ORDER_ACTIONS) {
      assert(FORMATION_IDS.some(id => orderActionId(id) === o.action),
        `${o.action} is excused by the order wheel and is not a formation the wheel builds`);
    }

    // Every pad code names a real button or a real stick direction, so a typo
    // is a dead binding rather than a silent one.
    const known = new Set([...PAD_CODES, ...PAD_AXIS_CODES]);
    const bogus = [];
    for (const id of ACTION_IDS) {
      for (const code of b[id] || []) {
        if (!isPadCode(code)) continue;
        for (const p of chordParts(code)) if (!known.has(p)) bogus.push(`${id} → ${p}`);
      }
    }
    assert(!bogus.length, `pad codes that name no button: ${bogus.join(', ')}`);

    // …and the pad map has to be as clash-free as the keyboard one. `conflicts`
    // already runs over the shipped table above; this is the same question
    // asked of the pad half alone, so a duplicate cannot hide behind 46 keys.
    const byCode = new Map();
    for (const id of ACTION_IDS) {
      for (const code of (b[id] || []).filter(isPadCode)) {
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(id);
      }
    }
    const dup = [...byCode].filter(([, ids]) => ids.length > 1);
    assert(!dup.length,
      `one pad code, two actions: ${dup.map(([c, ids]) => `${keyLabel(c)} → ${ids.join('+')}`).join('; ')}`);

    /* THE MODIFIERS HOLD NOTHING OF THEIR OWN. A modifier that also fires
     * something means every cast drops whatever it was holding for the frame
     * the chord lands on — see PAD_MODIFIERS for why that is a decision. */
    for (const m of PAD_MODIFIERS) {
      const bare = ACTION_IDS.filter(id => (b[id] || []).includes(m));
      assert(!bare.length,
        `${keyLabel(m)} is a chord modifier AND fires ${bare.join('+')} on its own — `
        + 'every chord on it would drop that action for a frame');
      // …and it has to actually BE a modifier, or the layer is unreachable.
      const used = ACTION_IDS.some(id => (b[id] || []).some(c => isChord(c) && chordParts(c).includes(m)));
      assert(used, `${keyLabel(m)} is declared a modifier and no binding uses it`);
    }
    const chords = byCode.size ? [...byCode.keys()].filter(isChord).length : 0;
    return `${ACTION_IDS.length} actions, ${byCode.size} pad codes (${chords} chords, `
      + `${PAD_AXIS_CODES.length} stick), 0 unreachable, 0 doubled`;
  });

  check('controls: the most specific chord wins, through the real Input', () => {
    /**
     * The rule the header of Bindings.js has stated since it was written —
     * "with Push on F and Pull on Shift+F, holding shift must fire Pull and NOT
     * Push" — and which nothing implemented until the pad needed it. Driven
     * through a real Input against the shipped table, not against a fixture:
     * LB+A is Force push and A alone is Force jump.
     */
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const b = defaultBindings();
    const i = fresh();
    i.setBindings(b);

    const press = (...codes) => {
      i.padDownSet.clear(); i.padPressedSet.clear();
      for (const c of codes) { i.padDownSet.add(c); i.padPressedSet.add(c); }
    };
    press('PadA');
    assert(i.actHit('jump') && !i.actHit('push'), 'A alone does not jump, or it also pushes');
    press('PadLB', 'PadA');
    assert(i.actHit('push'), 'LB+A does not push');
    assert(!i.actHit('jump'),
      'LB+A jumps as well as pushing — the bare code is not suppressed and one press does two things');

    // The chord lands on whichever half arrives last: a player holding LB and
    // then pressing A, and a player pressing A and then adding LB, are both
    // asking for the same thing.
    i.padDownSet.clear(); i.padPressedSet.clear();
    i.padDownSet.add('PadA');
    i.padDownSet.add('PadLB'); i.padPressedSet.add('PadLB');
    assert(i.actHit('push') && !i.actHit('jump'), 'adding the modifier to a held button does not fire the chord');

    // A modifier held alone must fire NOTHING — it is the layer key, and a
    // player resting a finger on it is not asking for anything at all.
    for (const m of PAD_MODIFIERS) {
      press(m);
      const fired = ACTION_IDS.filter(id => i.act(id) || i.actHit(id));
      assert(!fired.length, `${keyLabel(m)} held alone fires ${fired.join(', ')}`);
    }

    // …and every chord in the shipped table really does answer, which is the
    // half a suppression rule can silently break: it is easy to write a mask
    // that turns the whole layer off.
    const silent = [];
    for (const id of ACTION_IDS) {
      const chord = (b[id] || []).find(c => isPadCode(c) && isChord(c));
      if (!chord) continue;
      press(...chordParts(chord));
      if (!(i.act(id) || i.actHit(id))) silent.push(`${id} (${keyLabel(chord)})`);
    }
    assert(!silent.length, `chords in the shipped map that fire nothing: ${silent.join(', ')}`);
    return `${ACTION_IDS.filter(id => (b[id] || []).some(c => isPadCode(c) && isChord(c))).length} chords all answer; `
      + 'LB+A pushes and does not jump, in either order';
  });

  check('controls: the left stick is in the table and is still analog', () => {
    /**
     * `moveAxis` carried `if (this.padLeft) { x += this.padLeft.x; y -= this.padLeft.y; }`
     * — a second set of movement bindings that no table knew about, added to
     * whatever the table said. That is exactly the defect the four
     * `|| this.down('ArrowUp')` were removed for one round ago, wearing a stick
     * instead of an arrow key, and the check written for THAT could not see it
     * because it probes key codes and a stick is not one.
     *
     * Both halves are asserted, because either alone is a different bug: in the
     * table (so it can be rebound and can be seen to collide) and ANALOG (so a
     * pad keeps the one thing it has that a keyboard does not).
     */
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const b = defaultBindings();
    for (const [id, code] of [['moveF', 'PadLUp'], ['moveB', 'PadLDown'],
      ['moveL', 'PadLLeft'], ['moveR', 'PadLRight']]) {
      assert((b[id] || []).includes(code), `${id} is not bound to ${code} — the stick is outside the table`);
      assert(findConflicts(b, code).join() === id,
        `findConflicts cannot see ${code}: it reports ${findConflicts(b, code).join('+') || 'nothing'}`);
    }
    const i = fresh();
    i.setBindings(b);
    /*
     * DRIVEN THROUGH `_readPad` AND NOT BY SETTING THE FIELDS.
     *
     * The first draft of this reached in and wrote `i.padAxis[1] = -0.1`, which
     * skips the deadzone — so it asserted a stick at rest read 0 while handing
     * the code a value the real one never produces, and failed. That is
     * HANDOFF §2.4 exactly: an instrument that restates a rule will eventually
     * disagree with it. The rule is applied ONCE, in Input, and this pushes a
     * raw axis value through the same door a controller does.
     */
    const gp = { connected: true, index: 0, id: 'Xbox Wireless Controller',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    const nav = { getGamepads: () => [gp] };
    const g = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    let third, full, both, rest;
    try {
      const at = (v) => { gp.axes = [0, v, 0, 0]; i._readPad(1 / 60); return i.moveAxis(); };
      // 0.496 raw, which is 0.4 once the 0.16 deadzone is taken off and the
      // rest rescaled — the number the player's thumb is actually asking for.
      third = at(-(0.16 + 0.4 * 0.84));
      assert(Math.abs(third.y - 0.4) < 1e-9,
        `the stick a third forward gives ${third.y.toFixed(3)} instead of 0.400 — it has been thresholded into a switch`);
      assert(i.act('moveF') && Math.abs(i.actAxis('moveF') - 0.4) < 1e-9,
        'act() and actAxis() disagree about the same stick position');
      full = at(-1);
      assert(Math.abs(full.y - 1) < 1e-9, `a stick at the stop gives ${full.y.toFixed(3)}`);
      // A key and the stick at once is ONE, not two — the old code summed them.
      i.keys.add('KeyW');
      both = at(-(0.16 + 0.4 * 0.84));
      assert(Math.abs(both.y - 1) < 1e-9,
        `W and a stick at 0.4 give ${both.y.toFixed(3)} — the two bindings are being added, not maxed`);
      i.keys.delete('KeyW');
      // Inside the deadzone is nothing at all, on both answers.
      rest = at(-0.1);
      assert(rest.y === 0 && !i.act('moveF'), `a stick at rest reads ${rest.y}`);
    } finally {
      if (g === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: g, configurable: true, writable: true });
    }
    return `stick bound to moveF/B/L/R and visible to findConflicts; ${third.y.toFixed(3)} at a third, `
      + `${full.y.toFixed(3)} at the stop, ${rest.y.toFixed(3)} inside the deadzone, `
      + `${both.y.toFixed(3)} for W and a third of a stick together`;
  });

  check('controls: an analog trigger is a button, and the pad has an EDGE', () => {
    /**
     * TWO THINGS THE OLD PAD PATH COULD NOT DO.
     *
     * `this.padButtons = gp.buttons` held a reference to a SNAPSHOT — Chromium
     * returns fresh objects on every `getGamepads()` — so there was no previous
     * frame to compare against and therefore no press edge at all. Every pad
     * read was a `down`. `blade` is a hold and `jump` is a press, and half the
     * verbs in this game are the second kind.
     *
     * And a trigger reports a `value`, with `pressed` left to the browser: some
     * pads only set it at the stop. `blade` is on RT, so a guard the player
     * cannot raise is what "honour pressed only" would mean.
     */
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const i = fresh();
    i.setBindings(defaultBindings());
    const pad = { connected: true, index: 0, id: 'Xbox Wireless Controller', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    const nav = { getGamepads: () => [pad] };
    const g = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    try {
      const RT = 7;   // 'PadRT' — `blade`
      const set = (v, pressed = false) => { pad.buttons[RT] = { pressed, value: v }; i._readPad(1 / 60); };
      set(0.2);
      assert(!i.act('blade'), 'a trigger barely touched already takes the blade');
      set(0.5);
      assert(i.act('blade') && i.actHit('blade'),
        'a trigger pulled halfway does not take the blade — `pressed` is being trusted alone');
      set(0.5);
      assert(i.act('blade') && !i.actHit('blade'),
        'a held trigger keeps firing its press edge — there is no previous frame');
      set(0);
      assert(!i.act('blade'), 'a released trigger is still held');
      // …and a pad that reports only the flag still works.
      set(0, true);
      assert(i.act('blade') && i.actHit('blade'), 'a pad that sets `pressed` with no value is ignored');

      // The press edge, on an ordinary button, across two frames.
      pad.buttons[RT] = { pressed: false, value: 0 };
      pad.buttons[0] = { pressed: true, value: 1 };
      i._readPad(1 / 60);
      assert(i.actHit('jump'), 'A pressed does not fire jump');
      i._readPad(1 / 60);
      assert(i.act('jump') && !i.actHit('jump'), 'A held re-fires jump every frame');

      /* START IS THE WAY OUT, and only when no modifier is held — the pad map
       * puts real bindings on Start chords. */
      let menus = 0;
      i.onMenu = () => { menus++; };
      pad.buttons[0] = { pressed: false, value: 0 };
      pad.buttons[9] = { pressed: true, value: 1 };
      i._readPad(1 / 60);
      assert(menus === 1, `Start raised the menu ${menus} times`);
      pad.buttons[9] = { pressed: false, value: 0 }; i._readPad(1 / 60);
      pad.buttons[4] = { pressed: true, value: 1 };   // LB
      i._readPad(1 / 60);
      pad.buttons[9] = { pressed: true, value: 1 };
      i._readPad(1 / 60);
      assert(menus === 1, 'LB+Start opened the menu as well as firing its chord');
      assert(i.actHit('lessonRepeat'), 'LB+Start does not fire the chord it is bound to');
    } finally {
      if (g === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: g, configurable: true, writable: true });
    }
    return 'trigger 0.2 off / 0.5 on / flag-only on; press edge fires once and not twice; '
      + 'Start opens the menu bare and fires its chord under a modifier';
  });

  check('controls: a pad can rebind itself, and one press still does one thing', async () => {
    /**
     * A PAD CODE THE GAME CAN BIND AND THE PLAYER CANNOT IS HALF A CONTROL —
     * the shipped default map would then be the only map that exists, which is
     * the thing this table was built to stop being true of the keyboard.
     *
     * The press arrives through `Input.onPadCode` rather than a listener,
     * because a gamepad raises no DOM events at all: it is polled, and Input is
     * the one thing polling it. And it arrives AS THE CHORD it was pressed
     * with, so binding "LB + A" is the same gesture that fires it.
     *
     * The rest of this check is the ordering, which is where one press would
     * otherwise do two things — inside the editor for the table whose whole
     * purpose is that it cannot.
     */
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const i = fresh();
    i.setBindings(defaultBindings());
    const pad = { connected: true, index: 0, id: 'Xbox Wireless Controller', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    const nav = { getGamepads: () => [pad] };
    const g = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    const down = (...ix) => {
      for (let k = 0; k < 16; k++) pad.buttons[k] = { pressed: ix.includes(k), value: ix.includes(k) ? 1 : 0 };
      i._readPad(1 / 60);
    };
    try {
      const seen = [];
      let confirms = 0, navs = 0, menus = 0;
      i.onConfirm = () => { confirms++; };
      i.onNav = () => { navs++; };
      i.onMenu = () => { menus++; };

      // Nothing listening: A confirms, the D-pad walks, Start opens the menu.
      i.onPadCode = () => false;
      down(0); down();
      down(12); down();
      down(9); down();
      assert(confirms === 1 && navs === 1 && menus === 1,
        `with no chip listening: ${confirms} confirms, ${navs} navs, ${menus} menus — expected one each`);

      // A chip listening TAKES the press, and nothing else sees it.
      i.onPadCode = (code) => { seen.push(code); return true; };
      confirms = 0; navs = 0; menus = 0;
      down(0);
      assert(seen.join() === 'PadA', `the chip was offered ${seen.join('+') || 'nothing'}`);
      assert(confirms === 0, 'A was bound to an action AND pressed the focused control');
      down();
      // …and a chord is offered as a chord, not as its main button.
      seen.length = 0;
      down(4, 0);
      assert(seen.join() === 'PadLB+PadA',
        `holding LB and pressing A offered ${seen.join('+')} — a chord cannot be bound from a pad`);
      down();

      // A DIRECTION that was just bound is still under the thumb, and must not
      // start walking the list the moment the chip stops listening.
      seen.length = 0; navs = 0;
      down(12);                        // captured
      i.onPadCode = () => false;       // the chip has finished
      down(12); down(12); down(12);
      assert(navs === 0, `a direction held through a rebind walked the list ${navs} times`);
      down();                          // released
      down(12);
      assert(navs === 1, 'the direction never became a navigation again after being released');

      // Start CANCELS a listening chip rather than opening the menu.
      let cancelled = null;
      i.onPadCode = (code) => { cancelled = code; return true; };
      menus = 0;
      down(); down(9);
      assert(cancelled === 'PadStart' && menus === 0,
        `Start during a rebind: offered ${cancelled}, opened the menu ${menus} times`);
    } finally {
      if (g === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: g, configurable: true, writable: true });
    }

    // …and the Menu really does turn that into a cancel and report the take.
    const menuSrc = await readFile(src('ui/Menu.js'), 'utf8');
    assert(/this\._padCapture\(code === 'PadStart' \? null : code\);\s*\n\s*return true;/.test(menuSrc),
      'Menu.padCode no longer cancels on Start or no longer reports that it took the press');
    const mainSrc = await read('src/main.js');
    assert(/input\.onPadCode = \(code\) => !!menu\.padCode\?\.\(code\)/.test(mainSrc),
      'main.js drops padCode\'s answer, so Input cannot know the press was taken');
    return 'a chip takes A, LB+A as a chord and Start as a cancel; a taken press fires no confirm, '
      + 'no nav and no menu, and a held direction waits to be let go of';
  });

  check('controls: every prompt in the game names the device in the player\'s hands', async () => {
    /**
     * THE TYPED-KEY-NAME RULE, EXTENDED TO THE THING BEING HELD.
     *
     * "No player-facing surface types a key name" is already a check, and it is
     * satisfied by printing the BINDING. A player holding a controller was
     * still told to press Tab, Ctrl and P — correct against the table and
     * useless in their hands. So the surfaces read the ACTIVE DEVICE, and this
     * asserts what a player would actually read.
     *
     * The default is the keyboard everywhere, which is what keeps every other
     * check in this file — and the markup it measures — byte-identical.
     */
    const b = defaultBindings();
    const key = codexHtml(b);
    const pad = codexHtml(b, { device: 'pad', family: 'xbox' });
    assert(key !== pad, 'the Codex renders the same markup on a pad as on a keyboard');
    const chips = (s) => [...s.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1].replace(/^Hold /, ''));

    // Nothing keyboard-only survives into the pad render, and nothing pad-only
    // leaks into the keyboard one. Both directions, because either alone is a
    // surface that half-changed.
    const padChips = new Set(chips(pad));
    const keyChipSet = new Set(chips(key));
    assert(padChips.size && keyChipSet.size, 'one of the two Codex renders prints no keys at all');
    // Named, because these five are the ones a controller cannot press at all:
    // there is no Tab, no Caps Lock, no wheel and no mouse button on a pad, so
    // finding one of them in the pad render is a surface that did not swap.
    for (const stray of ['Tab', 'Caps', 'Wheel ↑', 'M1', 'M2']) {
      assert(keyChipSet.has(stray),
        `"${stray}" is gone from the keyboard Codex — this check is no longer measuring the swap`);
      assert(!padChips.has(stray),
        `the Codex still says "${stray}" to a player holding a controller`);
    }
    // …and every action's pad binding really is what the pad render prints.
    const silent = [];
    for (const id of ACTION_IDS) {
      const code = codesFor(b, id, 'pad')[0];
      if (!isPadCode(code)) continue;
      if (!padChips.has(keyLabel(code, 'xbox'))) silent.push(`${id} (${keyLabel(code)})`);
    }
    assert(!silent.length, `bound to a pad and printed on no screen: ${silent.join(', ')}`);

    // The pause card names the OTHER device-level button — Start, not Esc.
    assert(pauseHintsHtml(b).includes('<kbd>Esc</kbd>'), 'the pause card no longer names Esc');
    const padHints = pauseHintsHtml(b, { device: 'pad', family: 'xbox' });
    assert(!padHints.includes('<kbd>Esc</kbd>') && padHints.includes('<kbd>Menu</kbd>'),
      `the pause card tells a controller player to press Esc: ${padHints}`);

    /**
     * AND THE SAME BUTTON IS CALLED THREE THINGS. The standard mapping fixes
     * the POSITION and nothing fixes the name — index 3 is Y, △ or X depending
     * on the shell — so a screen that says "Y" to somebody holding a DualSense
     * is the typed-key-name defect wearing a controller.
     */
    const seen = new Map();
    for (const f of PAD_FAMILY) {
      const label = padLabel('PadY', f);
      assert(label && label !== 'PadY', `${f} has no name for button 3`);
      seen.set(f, label);
    }
    assert(new Set(seen.values()).size === PAD_FAMILY.length,
      `three families print the same name for button 3: ${[...seen].map(([f, l]) => `${f} ${l}`).join(', ')}`);
    for (const [id, want] of [['Xbox Wireless Controller', 'xbox'],
      ['DualSense Wireless Controller', 'playstation'],
      ['Pro Controller (STANDARD GAMEPAD)', 'nintendo'],
      ['some unknown vendor pad', 'xbox']]) {
      assert(padFamily(id) === want, `"${id}" is read as a ${padFamily(id)} pad, not ${want}`);
    }

    // Every surface in the game that prints a live binding has to be handed the
    // device, and there are six of them across three files. Stated as source,
    // because "did the free camera's caption repaint" has no headless answer.
    const main = await read('src/main.js');
    assert(/input\.onDevice = \(\) => \{/.test(main),
      'main.js never listens for the device changing, so nothing repaints when a pad is picked up');
    for (const call of ['menu.setDevice(input.device, input.padFamily)',
      'hud.setBindings(input.bindings, padOf())', 'refreshCoachKeys()']) {
      assert(main.includes(call), `the device change does not reach ${call}`);
    }
    const hudSrc = await readFile(src('ui/HUD.js'), 'utf8');
    assert(/setBindings\(bindings, pad = this\._pad\)/.test(hudSrc),
      'HUD.setBindings no longer takes the device, so the power wheel cannot follow it');
    return `${padChips.size} pad glyphs in the Codex against ${keyChipSet.size} keyboard ones; `
      + `button 3 prints ${[...seen.values()].join(' / ')}; pause card says `
      + `${padHints.match(/<kbd>([^<]*)<\/kbd>/)[1]} on a pad`;
  });

  check('controls: the pad rumbles, and the slider is the strength it rumbles at', async () => {
    /**
     * `Engine.rumble` shipped with `clamp(num(this.rumbleLevel, 1), 0, 1)` and a
     * note saying the field is deliberately uninitialised because "a field
     * written once to the identity of its own operation and moved by nothing
     * would be a second gate that is a claim rather than a control", and that
     * "the day a strength slider exists it assigns this and every call scales".
     * This is both halves of that: the slider exists, and it lands on the seam.
     *
     * Driven through the real `Engine.prototype.rumble` against a fake pad, so
     * what is measured is the magnitude a controller would actually be sent.
     */
    const { Engine } = await import('../../src/engine/Engine.js');
    const sent = [];
    const pad = { connected: true, vibrationActuator: {
      playEffect: (kind, o) => { sent.push({ kind, ...o }); return Promise.resolve(); } } };
    const nav = { getGamepads: () => [pad] };
    const g = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    try {
      const e = { _rumbleUntil: 0, rumble: Engine.prototype.rumble };
      // An engine nobody has spoken to rumbles at full — the `?? 1` is what
      // keeps every headless harness measuring the shipped behaviour.
      assert(e.rumble(0.8, 0.4, 100) === true, 'a fresh engine does not rumble at all');
      assert(Math.abs(sent[0].strongMagnitude - 0.8) < 1e-9,
        `an unset rumbleLevel sent ${sent[0].strongMagnitude} instead of the full 0.8`);
      e._rumbleUntil = 0;
      e.rumbleLevel = 0.5;
      e.rumble(0.8, 0.4, 100);
      assert(Math.abs(sent[1].strongMagnitude - 0.4) < 1e-9,
        `at 50% the pad was sent ${sent[1].strongMagnitude}, not half of 0.8`);
      e._rumbleUntil = 0;
      e.rumbleLevel = 0;
      assert(e.rumble(1, 1, 100) === false && sent.length === 2,
        'at 0 the slider still sends the pad an effect');

      // A LONGER EFFECT IS NOT CUT SHORT BY A SHORTER ONE — a wave of kills at
      // 60 ms each must not truncate the 400 ms of a boss going down.
      e.rumbleLevel = 1;
      e._rumbleUntil = 0;
      e.rumble(1, 1, 400);
      const before = sent.length;
      e.rumble(0.2, 0.1, 60);
      assert(sent.length === before, 'a short rumble interrupted a long one');
    } finally {
      if (g === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: g, configurable: true, writable: true });
    }

    // The seam, from the other end: applyFeelSettings is what writes it, so a
    // player moving the slider mid-fight feels the next kill at the new level.
    const world = { engine: { }, players: [], addHitstop() {}, feelOn: () => true };
    applyFeelSettings(world, { ...DEFAULT_SETTINGS, rumble: 0.25 });
    assert(world.engine.rumbleLevel === 0.25,
      `the slider wrote ${world.engine.rumbleLevel} onto the engine`);
    applyFeelSettings(world, { ...DEFAULT_SETTINGS, rumble: undefined });
    assert(world.engine.rumbleLevel === 1, 'a missing rumble setting does not fall back to full strength');

    /**
     * AND IT IS NOT A SECOND GATE ON `shake`. Every rumble call site already
     * asks `world.feelOn('shake')` first — tools/checks/feel.mjs pins that the
     * pad stays silent with the box off — so this scales what survives it. Two
     * controls that mean different things, which is the whole reason the note
     * over rumbleLevel refused to initialise the field.
     */
    const engineSrc = await readFile(src('engine/Engine.js'), 'utf8');
    assert(/num\(this\.rumbleLevel, 1\)/.test(engineSrc),
      'Engine.rumble no longer reads rumbleLevel — the slider is wired to nothing');
    const sites = [];
    for (const f of ['game/World.js', 'game/Player.js']) {
      const text = await readFile(src(f), 'utf8');
      for (const m of text.matchAll(/engine\??\.rumble\?\.\(/g)) sites.push(f);
    }
    assert(sites.length >= 3,
      `only ${sites.length} rumble call sites — a kill, a blow taken and a deflection is three`);
    return `unset → 0.800, 50% → 0.400, 0 → silent; ${sites.length} call sites; `
      + 'a 60 ms effect does not cut a 400 ms one';
  });

  check('controls: the letterbox and the death drain are switches, and not the shake box', async () => {
    /**
     * THE TWO EFFECTS THAT WERE DELIBERATELY LEFT UNGATED.
     *
     * `shake` and `slowmo` have had boxes for a while. The colour draining out
     * of the frame when you die, and the letterbox that arrives with it and
     * with a boss, had none — and folding them into `shake` would have been the
     * wrong fix, for the reason that kept them out of it: with motion feedback
     * off they are the ONLY cue that you died. A player who turns motion off
     * for comfort would have been left with nothing on screen at the one moment
     * that matters.
     *
     * So: two switches of their own, both on, both gated at the FUNNEL —
     * `setBars` and `setDrain` are the only writers of either target, exactly
     * as `CameraRig.addShake` is the only writer of `rig.shake` — and this
     * asserts the independence in both directions, which is the part a shared
     * gate would silently break.
     */
    const { Engine } = await import('../../src/engine/Engine.js');
    const mk = () => ({ _barsTarget: 0, _drainTarget: 0,
      setBars: Engine.prototype.setBars, setDrain: Engine.prototype.setDrain });

    // An engine nobody has spoken to draws both — the shipped behaviour, which
    // is what every headless harness and every check is measuring.
    const fresh = mk();
    fresh.setBars(0.085); fresh.setDrain(0.72);
    assert(fresh._barsTarget === 0.085 && fresh._drainTarget === 0.72,
      `an unset engine drew bars ${fresh._barsTarget} / drain ${fresh._drainTarget}`);

    const off = mk();
    off.letterboxOn = false;
    off.setBars(0.085); off.setDrain(0.72);
    assert(off._barsTarget === 0, `the letterbox is off and the bars are still ${off._barsTarget}`);
    assert(off._drainTarget === 0.72,
      'turning the letterbox off also drained the colour — the two switches are one');
    const off2 = mk();
    off2.deathDrainOn = false;
    off2.setBars(0.085); off2.setDrain(0.72);
    assert(off2._drainTarget === 0, `the drain is off and the colour is still at ${off2._drainTarget}`);
    assert(off2._barsTarget === 0.085,
      'turning the drain off also took the bars — the two switches are one');

    /* THE SHAKE BOX MUST NOT REACH EITHER. This is the whole point: motion off
     * and these two still on is the state the design is protecting. */
    const world = { engine: mk(), players: [], addHitstop() {}, feelOn: () => true };
    applyFeelSettings(world, { ...DEFAULT_SETTINGS, shake: false, slowmo: false });
    world.engine.setBars(0.085); world.engine.setDrain(0.72);
    assert(world.engine._barsTarget === 0.085 && world.engine._drainTarget === 0.72,
      'with camera shake off the bars and the drain went with it — they are the only cue left');

    // …and each box really does reach the engine, live.
    applyFeelSettings(world, { ...DEFAULT_SETTINGS, letterbox: false });
    assert(world.engine.letterboxOn === false && world.engine._barsTarget === 0,
      'unticking the letterbox neither armed the gate nor released the frame already drawn');
    applyFeelSettings(world, { ...DEFAULT_SETTINGS, deathDrain: false });
    assert(world.engine.deathDrainOn === false && world.engine._drainTarget === 0,
      'unticking the drain neither armed the gate nor released the frame already drawn');
    applyFeelSettings(world, { ...DEFAULT_SETTINGS });
    assert(world.engine.letterboxOn === true && world.engine.deathDrainOn === true,
      'the boxes do not come back on');

    /**
     * AND THE NAMES ARE THE FEEL KINDS, which is what wires the funnel with no
     * new lookup: `World.feelOn(kind)` is `s[kind] !== false`, so naming the
     * settings after the kinds means anything holding a world can ask
     * `feelOn('letterbox')` and nothing in World.js had to learn a word.
     */
    const feelOn = World.prototype.feelOn;
    for (const kind of ['letterbox', 'deathDrain', 'shake', 'slowmo']) {
      assert(kind in DEFAULT_SETTINGS, `feelOn('${kind}') names no setting`);
      assert(feelOn.call({ _feelSettings: { ...DEFAULT_SETTINGS, [kind]: false } }, kind) === false,
        `feelOn('${kind}') answers yes with the setting off`);
      assert(feelOn.call({ _feelSettings: DEFAULT_SETTINGS }, kind) === true,
        `feelOn('${kind}') answers no with the setting on`);
      assert(feelOn.call({}, kind) === true,
        `a world nobody has spoken to says no to ${kind} — every harness would measure the wrong game`);
    }
    return 'bars and drain independent of each other and of the shake box; '
      + `feelOn answers for ${['letterbox', 'deathDrain', 'shake', 'slowmo'].join('/')}`;
  });

  check('controls: no gameplay reads a raw key code or a raw device', async () => {
    // The rule the arrows broke, stated once for the whole tree. A raw
    // `down('KeyX')` is not in ACTIONS, so it cannot be rebound, cannot be
    // shown, and cannot be seen to collide — every version of this bug this
    // project has had (B/N in Player, B/N/Y in main.js, the arrows in Input)
    // was one of these.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const files = ['engine/Input.js', 'game/Player.js', 'game/SaberController.js', 'game/World.js', 'game/Enemy.js'];
    const raw = [];
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(/\.(?:down|hit|up|anyDown)\((\s*'[^']+'[^)]*)\)/g)) {
        raw.push(`${f}: .${m[0].slice(1)}`);
      }
    }
    assert(!raw.length, `raw key codes read past the bindings table: ${raw.join('; ')}`);

    // ── the same rule for the DEVICES, which is where the last one was hiding.
    //
    // The check above only ever looked at key codes, so the wheel sailed past
    // it for the whole of v1: SaberController spent it on wrist roll and Player
    // spent it on grip distance, neither was in ACTIONS, and the collision could
    // only be resolved by Player physically stealing the field
    // (`input.mouse.wheel = 0`) before the blade could read it. A device read is
    // exactly as unrebindable as a key code and this now says so.
    //
    // ONE exception, named and bounded rather than pattern-matched away:
    // Player's grip distance still reads the wheel raw. It is a continuous
    // magnitude (notches of hold distance), not a press, so it is not an ACTION
    // in the shape ACTIONS describes — putting it in the table would mean
    // inventing analogue bindings. It is listed here so it is visible and so a
    // SECOND one cannot appear beside it unremarked.
    const ALLOWED = new Set(['game/Player.js']);
    /**
     * …AND THE PAD, WHICH THIS PATTERN COULD NOT SEE.
     *
     * `input.padDown(4)` and `input.padDown(5)` sat in SaberController's wrist
     * roll for the whole life of the project and sailed past every clause of
     * this check: the key-code clause matches a QUOTED argument and 4 is not
     * one, and the device clause named the mouse's fields and not the pad's.
     * Two controls that no binding could move, on the one device that had no
     * bindings at all — the exact bug this check exists for, in the blind spot
     * of its own regex.
     *
     * They also went wrong the moment the pad had a default map: button 4 is
     * LB, which is the Force modifier, so holding it to cast would have rolled
     * the wrist. `rollL`/`rollR` are on the D-pad and read as actions now.
     */
    const devices = [], excused = [];
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(
        /\binput\.mouse\.(wheel|buttons)\b|\binput\.(?:buttons|buttonPressed)\s*\[|\binput\.pad(?:Down|Buttons|Left|Axis|DownSet|PressedSet)\b/g)) {
        (ALLOWED.has(f) ? excused : devices).push(`${f}: ${m[0]}`);
      }
    }
    assert(!devices.length,
      `raw device reads past the bindings table: ${devices.join('; ')} — `
      + 'a wheel notch, a mouse button or a pad button read this way cannot be rebound '
      + 'and cannot be seen to collide');
    return `${files.length} gameplay files, 0 raw key-code reads, `
      + `0 unexcused raw device reads (${excused.length} excused: ${excused.join(', ') || 'none'})`;
  });

  check('controls: every damage() call site matches the signature', async () => {
    // The third distinct bug this one method has produced. The signature is
    // (amount, point, source, kind); Player._land shipped
    // `this.damage(clamp(...), null, 'fall')` — three arguments, so `source`
    // received the string 'fall' and `kind` received undefined, while
    // Enemy.js's identical fall-damage line has always passed four. Nothing
    // threw, because a string is a perfectly good value for a parameter nobody
    // dereferences until somebody does.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const args = (s) => {
      const out = []; let depth = 0, cur = '';
      for (const ch of s) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const files = ['game/Player.js', 'game/Enemy.js', 'game/World.js', 'game/Duel.js'];
    /**
     * THE ARITY CEILING IS READ OFF THE METHODS, NOT TYPED HERE.
     *
     * It was the literal 4, and it went red the day `Enemy.damage` grew a fifth
     * parameter (`preResisted = false`) and a caller used it — a call that is
     * CORRECT reported as a defect, which is the direction HANDOFF §2.4 warns
     * about: an instrument that restates a rule eventually disagrees with it and
     * manufactures a finding. The floor of 3 stays typed, because THAT is the
     * bug this check exists for: `damage(x, null, 'fall')` put a string in the
     * `source` slot and left `kind` undefined, and nothing threw.
     */
    const DECL = /(?:^|\n)\s{2}damage\(([^)]*)\)\s*\{/g;
    let ceiling = 4;
    for (const f of ['game/Player.js', 'game/Enemy.js']) {
      for (const m of strip(await readFile(src(f), 'utf8')).matchAll(DECL)) {
        ceiling = Math.max(ceiling, args(m[1]).length);
      }
    }
    const bad = [], kinds = new Set();
    let sites = 0;
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(/(\w+)\.damage\(([^;]*?)\);/g)) {
        const list = args(m[2]);
        // Props take (amount, point, dir) and are a different class with a
        // different third parameter, so they are identified by their receiver
        // rather than by arity — `pr` and `prop` are the only names used.
        if (/^(pr|prop)$/.test(m[1])) continue;
        sites++;
        if (list.length < 3 || list.length > ceiling) {
          bad.push(`${f}: ${m[1]}.damage(${m[2]}) has ${list.length} arguments, and damage() `
            + `declares at most ${ceiling}`);
          continue;
        }
        // A string in the SOURCE slot is the bug, exactly.
        if (/^'[^']*'$/.test(list[2])) {
          bad.push(`${f}: ${m[1]}.damage(…) passes ${list[2]} as \`source\`, which takes an entity — `
            + 'it belongs in `kind`, and `kind` is then undefined');
        }
        if (list.length >= 4) {
          if (!/^'[^']*'$/.test(list[3])) bad.push(`${f}: \`kind\` is ${list[3]}, which is not a string literal`);
          else kinds.add(list[3]);
        }
        // Anything past `kind` is a FLAG. A string there is the same mistake as
        // a string in `source`, one slot along, and it would be just as silent.
        for (let i = 4; i < list.length; i++) {
          if (/^'[^']*'$/.test(list[i])) {
            bad.push(`${f}: ${m[1]}.damage(…) passes the string ${list[i]} where damage() takes a flag`);
          }
        }
      }
    }
    assert(!bad.length, bad.join('; '));
    // Fall damage specifically, on both sides, because that is where it went
    // wrong and Enemy is the version that was always right.
    for (const f of ['game/Player.js', 'game/Enemy.js']) {
      const body = strip(await readFile(src(f), 'utf8'));
      const line = [...body.matchAll(/\w+\.damage\(([^;]*?)\);/g)].find(m => /'fall'/.test(m[1]));
      assert(line, `${f} no longer deals fall damage`);
      const list = args(line[1]);
      assert(list.length === 4 && list[3] === "'fall'",
        `${f} calls damage(${line[1]}) — 'fall' must be the fourth argument, \`kind\``);
    }

    // And through the real code, not only the source: _land with a killing
    // impact, recording what Player.damage is handed.
    const rec = [];
    const body = Object.assign(Object.create(Player.prototype), {
      position: new THREE.Vector3(), cloak: null, camera: { addShake() {} },
      boonMods: { repulse: false }, _shockwave() {},
      damage(...a) { rec.push(a); return false; },
    });
    body._land({ particles: null, terrain: null }, 40);
    assert(rec.length === 1, 'a 40 m/s landing dealt no fall damage at all');
    const [amount, point, source, kind] = rec[0];
    assert(Number.isFinite(amount) && amount > 0, `fall damage was ${amount}`);
    assert(point === null, `fall damage passed ${point} as the impact point`);
    assert(source === null || typeof source === 'object',
      `fall damage passed ${JSON.stringify(source)} as \`source\`, which every other call site fills with an entity`);
    assert(kind === 'fall', `fall damage reported kind ${JSON.stringify(kind)}`);
    return `${sites} damage() call sites across ${files.length} files, kinds ${[...kinds].sort().join(' ')}; `
      + `_land → (${amount.toFixed(1)}, null, null, 'fall')`;
  });

  check('controls: a world knob that never moves is not a knob', async () => {
    // `this.hpScale = 1` and `this.dmgScale = 1` sat in the World constructor,
    // were read by Enemy as `A.hp * (world.hpScale ?? 1)`, and were written by
    // nothing else anywhere — no difficulty, no mode, no wave, no control. A
    // value written once to the identity of the operation it feeds is a claim
    // that a knob exists. Enemy's `?? 1` is what keeps the seam open, so
    // deleting the write costs nothing and stops the claim.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const world = strip(await readFile(src('game/World.js'), 'utf8'));
    const all = (await Promise.all(['game/World.js', 'game/Waves.js', 'game/Player.js', 'game/Enemy.js', 'main.js']
      .map(f => readFile(f === 'main.js' ? new URL('../../src/main.js', import.meta.url) : src(f), 'utf8'))))
      .map(strip).join('\n');
    const idle = [];
    for (const m of world.matchAll(/this\.(\w+)\s*=\s*1\s*;/g)) {
      const name = m[1];
      // Anything written again, to anything other than 1, is a live knob.
      const moved = new RegExp(`(?:this|world|w)\\.${name}\\s*=\\s*(?!1\\s*;)`, 'g');
      const hits = [...all.matchAll(moved)];
      if (!hits.length) idle.push(name);
    }
    assert(!idle.length,
      `written once, to 1, and moved by nothing: ${idle.join(', ')} — `
      + 'either give it a writer or let its reader default it');
    for (const name of ['hpScale', 'dmgScale']) {
      assert(!new RegExp(`this\\.${name}\\s*=`).test(world),
        `World writes ${name} again — if that write is real it must not be the identity`);
      const enemy = await readFile(src('game/Enemy.js'), 'utf8');
      assert(new RegExp(`world\\.${name}\\s*\\?\\?\\s*1`).test(enemy),
        `Enemy no longer defaults ${name}, so removing the constructor write would break it`);
    }
    return 'no World field is written once to its own identity; hpScale/dmgScale default in Enemy';
  });

  check('controls: Blade holds position is a setting, a box, and a live flag', () => {
    // SaberController.holdPosition has been read every frame since it was
    // written, World.spawnPlayer has always read `this.settings.bladeHold` into
    // it, and there was no such key in DEFAULT_SETTINGS and no box anywhere:
    // the reader read undefined forever. The structural half is covered by
    // "every setting has a control"; this is the behavioural half.
    assert('bladeHold' in DEFAULT_SETTINGS, 'bladeHold is not a setting');
    assert(DEFAULT_SETTINGS.bladeHold === false, 'blade-holds-position now defaults to ON');
    const w = { players: [{ control: { holdPosition: false } }], hitstop: 0, addHitstop() {} };
    applyFeelSettings(w, { ...DEFAULT_SETTINGS, bladeHold: true });
    assert(w.players[0].control.holdPosition === true,
      'ticking the box does not reach a player already in the world — it would land on the next deploy');
    applyFeelSettings(w, { ...DEFAULT_SETTINGS, bladeHold: false });
    assert(w.players[0].control.holdPosition === false, 'unticking the box does not reach the player');
    // The flag has to still mean something at the far end.
    assert(new SaberController().holdPosition === false, 'the controller no longer starts off');
    return 'bladeHold: default off, checkbox #opt-bladehold, pushed live onto every player by applyFeelSettings';
  });

  check('controls: every price the blade raises is a price somebody pays', async () => {
    /**
     * TWO BALANCE HOLES HID IN THE SAME SHAPE, and the shape is `if (ctx.onX)`.
     *
     * `SaberController.applyInput` raises a hook where an attack costs
     * something and lets the CALLER decide what the cost is, which is right:
     * stamina belongs to the Player and the controller is not allowed to know
     * about it. But an unsupplied hook is not a cost of zero that somebody
     * chose — it is a promise nobody keeps, and it fails silently, forever.
     *
     * `ctx.onSpin` and `ctx.onStrain` were both raised and never supplied.
     * Player.js's own notes record what that was worth: a full-revolution spin
     * that does about eight times an overhead's work was FREE and therefore the
     * answer to every fight in the game, and a chambered heavy was a state you
     * entered once and swung out of forever. Both are wired now, both with the
     * arithmetic beside them — and `onSwing` and `onChamber` were still raised
     * and still unsupplied, which is the same loaded gun with nothing in it
     * yet.
     *
     * So the rule, rather than the two lines: a hook the blade raises must be a
     * hook a caller supplies. Either it costs something and somebody pays, or
     * it does not exist. The check is a source read for the reason menu.mjs's
     * own header gives — the ctx literals are the fact, and constructing a
     * Player to observe an absence would only tell you the absence is quiet.
     */
    const blade = await read('src/game/SaberController.js');
    const player = await read('src/game/Player.js');
    const bare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    const raised = new Set([...bare(blade).matchAll(/\bctx\.(on[A-Z]\w*)/g)].map((m) => m[1]));
    assert(raised.size >= 3, `only ${raised.size} hooks found in the blade — the scan is not scanning`);

    /**
     * THE SUPPLIERS ARE THE ctx OBJECT LITERALS handed to `applyInput`, and
     * nothing else: a key written anywhere else in Player.js would match
     * `onSpin` in the note that explains it.
     *
     * AND EACH CALLER ANSWERS FOR ITSELF. The first cut took the UNION of the
     * two call sites, which is not the rule — Player calls `applyInput` twice,
     * and the driving-a-vehicle one supplies no hooks at all, so the union
     * passed while one of the two callers was exactly the shape being
     * forbidden. The blade does not know which caller it has.
     *
     * A caller that reaches none of the hooked verbs is exempt and has to SAY
     * so, which is what the `bladeHeld: false` half of the driving ctx already
     * means: no blade in the hand, no attack, no price. Anything else pays.
     */
    const src = bare(player);
    const sites = [];
    for (const m of src.matchAll(/applyInput\([^)]*?,\s*dt\s*,\s*\{/g)) {
      let depth = 0, i = src.indexOf('{', m.index + m[0].length - 1);
      for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) { sites.push(src.slice(i, j)); break; }
      }
    }
    assert(sites.length >= 2, `only ${sites.length} applyInput ctx literal(s) found — the scan is wrong`);

    const unpaid = [];
    for (const [i, body] of sites.entries()) {
      /* A caller with no blade in the hand cannot reach an attack, and says it
       * in the ctx itself. `grounded: true, moving: 0` is that literal today. */
      const supplied = new Set([...body.matchAll(/\b(on[A-Z]\w*)\s*:/g)].map((m) => m[1]));
      if (!supplied.size && /\bgrounded:\s*true/.test(body)) continue;
      for (const n of raised) if (!supplied.has(n)) unpaid.push(`site ${i + 1}: ${n}`);
    }
    assert(!unpaid.length,
      `the blade raises ${unpaid.join(', ')} and that caller supplies nothing for it — `
      + 'that is what made the spin and the chambered heavy free');
    return `${raised.size} hooks raised, ${sites.length} callers, every one paid or exempt: `
      + `${[...raised].sort().join(', ')}`;
  });

  check('controls: a key with two meanings names both of them', async () => {
    /**
     * ══ FINDING 9's OTHER HALF ══════════════════════════════════════════════
     *
     * This repository has refused a new binding row three times, so a second
     * meaning goes on an EXISTING key and the state decides which one you get —
     * `swap`, `drive`, `throw` and now `thrust`. That is a good pattern with one
     * price: the controls screen is the only place a player goes to find out
     * what a key does, and it prints `label`. Print half a key's meaning and the
     * other half is undiscoverable.
     *
     * It was: `thrust` read "Attack (thrust)" under **Blade** while also being
     * the whole of V15 §3's melee set — five strikes, a chain, six Holocron
     * facets — reachable only by pressing it with the sabre PUT AWAY, and
     * nothing on any screen said so.
     *
     * The bar is the pattern the other three already keep: a row whose action
     * `Player._readInput` branches on with the blade down states its second
     * meaning. Derived from `Player.js` rather than from a list typed here, so
     * a FIFTH key that grows a blade-down meaning is caught the day it does.
     */
    const psrc = await read('src/game/Player.js');
    const pcode = psrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /* The block `_readInput` runs only with the blade down — its own condition
     * is the seam, and everything `actHit`/`act` is asked for inside it is a key
     * that means something different there. */
    const i = pcode.indexOf("if (!this.saber?.lit && !this.gripBody && !this.gripEnemy) {");
    assert(i > 0, 'the blade-down input block has moved — this check is reading nothing');
    const block = pcode.slice(i, pcode.indexOf('\n    } else', i));
    const dual = [...new Set([...block.matchAll(/\bact(?:Hit)?\??\.?\(?'(\w+)'\)/g)].map(m => m[1]))];
    assert(dual.length >= 2,
      `only ${dual.length} key(s) read inside the blade-down block — the scan has stopped matching`);
    const short = [];
    for (const id of dual) {
      const row = ACTIONS.find(a => a.id === id);
      assert(row, `${id} is read with the blade down and is not in ACTIONS`);
      /* `/` is how this table already writes two meanings ("Drop / take a
       * saber", "Take / leave the controls", "Throw / recall saber"), so the
       * shape is the table's own and not a new convention. */
      if (!row.label.includes('/')) short.push(`${id}: "${row.label}"`);
    }
    assert(!short.length,
      `${short.join('; ')} — this key does something else entirely with the blade down and its `
      + 'own description on the controls screen does not say so, which is the only place a '
      + 'player could have found out');
    /* AND THE SECOND HALF IS ABOUT THE BLADE BEING DOWN, not just any slash: a
     * row could keep the punctuation and say nothing. */
    const thrust = ACTIONS.find(a => a.id === 'thrust');
    assert(/blade down|no blade|unarmed|strike|fist|punch/i.test(thrust.label),
      `the attack key reads "${thrust.label}" and never mentions what it does without a blade`);
    return `${dual.length} keys carry a blade-down meaning and every one names it: `
      + dual.map(id => `${id} "${ACTIONS.find(a => a.id === id).label}"`).join(', ');
  });
}
