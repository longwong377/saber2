/**
 * BATTLEFRONT BORZ — feel.
 *
 * Five things a combat designer found by playing, every one of which reads
 * perfectly well as source and is wrong as a number:
 *
 *   1. The blade cursor rested 22 deg above screen centre in third person,
 *      because Player set readyY back to the value a commit had just lowered.
 *   2. The catch gate read the blade's WORLD speed, so walking at 4.6 m/s made
 *      a rigid wrist clear a 3.2 m/s "driven blade" threshold on translation.
 *   3. The auto-guard cone was pinned to the chest position at the moment of
 *      the catch, so the player walked out of their own guard and left it in
 *      the world behind them.
 *   4. And because of 2, the "only a manual catch re-opens the cone" rule —
 *      the one thing keeping the mechanic off hold-to-win — was reachable by
 *      walking in a straight line.
 *   5. Lateral guard and flourish were seeded onto KeyB and KeyN at runtime,
 *      so they were in no table, in no menu, rebindable by nobody, and sharing
 *      their keys with two Force powers and the dojo's lesson navigation.
 *
 * Nothing here trusts a reading. Every check prints the number.
 */

import * as THREE from 'three';
import { Saber } from '../../src/game/Saber.js';
import { SaberController, READY_GUARD } from '../../src/game/SaberController.js';
import { CatchWindow, CATCH, captureSnapshot } from '../../src/game/Combat.js';
import { guardIntercept } from '../../src/game/Bolts.js';
import { Player, CameraRig } from '../../src/game/Player.js';
import { ACTIONS, ACTION_IDS, defaultBindings, findConflict } from '../../src/engine/Bindings.js';

const DEG = 180 / Math.PI;
const scene = new THREE.Scene();

/** Every .js under src/, as [relative path, text]. */
async function sources() {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../../src/', import.meta.url);
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(u, prefix + e.name + '/');
      else if (e.name.endsWith('.js')) out.push([prefix + e.name, await readFile(u, 'utf8')]);
    }
  };
  await walk(root, '');
  return out;
}

/** A controller driven for `frames` on a body moving at `speed` down -Z. */
function drive({ speed = 0, flickAt = -1, frames = 200 } = {}) {
  const c = new SaberController();
  const s = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  s.ignite(); s.ignition = 1;
  const aim = new THREE.Quaternion();
  const chest = new THREE.Vector3(0, 1.35, 0);
  c.reset(chest, aim);
  const carrier = new THREE.Vector3(0, 0, -speed);
  let dx = 0;
  const input = {
    mouse: { get dx() { return dx; }, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
    bindings: defaultBindings(),
    act: (id) => flickAt >= 0 && id === 'blade', actHit: () => false,
  };
  const dt = 1 / 60;
  let worst = null;
  for (let i = 0; i < frames; i++) {
    chest.z -= speed * dt;
    // 6 frames of 58 px is the ~350 px sweep bladeGain is tuned for: one
    // comfortable full slash, not an arm's length.
    dx = (flickAt >= 0 && i >= flickAt && i < flickAt + 6) ? 58 : 0;
    c.applyInput(input, dt, { stamina: 1 });
    c.update(dt, chest, aim, { stamina: 1, flow: 0 });
    s.setHiltPose(c.handPos, c.quat);
    s.carrierVel = carrier;
    s.update(dt, i * dt, carrier);
    if (i < 100) continue;                       // let the spring settle first
    const pt = s.pointAt(0.55, new THREE.Vector3());
    // a bolt arriving head-on: flying +Z into a body walking -Z, worst case
    const bolt = { pos: pt.clone(), prev: pt.clone(), vel: new THREE.Vector3(0, 0, 40), speed: 40 };
    const snap = captureSnapshot(bolt, s, { bladeT: 0.55, point: pt });
    if (!worst || snap.bladeSpeed > worst.bladeSpeed) worst = snap;
  }
  return worst;
}

/**
 * WHAT A BLOW ACTUALLY DID TO THE SENSES, counted rather than described.
 *
 * Every feedback channel the game has runs through a handful of named funnels —
 * `world.addHitstop`, `rig.addShake`, `engine.punch/flash/rumble`,
 * `world.setTimeScale`, `audio.tone/noise/bodyThump`. Recording them and
 * replaying the SAME blow twice, once against a body that survives it and once
 * against a body that does not, is the only way to answer the audit's actual
 * charge: that the two were byte-identical.
 *
 * Nothing here re-implements a rule. The world is the shipped `World`, the
 * death is the shipped `Enemy.die`, and the tape is a set of wrappers over the
 * real methods that call straight through.
 *
 * The tape is ARMED, the blow is struck, and the tape is torn off again — with
 * no `await` between the three, which is what makes it safe.
 *
 * `audio` is a module singleton shared by every World in the process and the
 * checks in one file interleave at their awaits (see _shared.mjs). The first
 * version of this left its wrappers installed across an await and measured the
 * OTHER condition's sounds into the first condition's counter: 14 against 7,
 * with the kill — the louder of the two — reading as the quieter. That is
 * HANDOFF §2.5 exactly, and it flattered the null hypothesis rather than the
 * one under test, which is the only reason it was believed for a minute.
 */
function tape(world, engine, audio) {
  const t = { hitstop: 0, shake: 0, punch: 0, flash: 0, rumble: 0, sounds: 0,
    scale: [], particles: 0 };
  const undo = [];
  const wrap = (o, k, note) => {
    if (!o) return;
    const f = o[k];
    undo.push(() => { o[k] = f; });
    o[k] = (...a) => { note(...a); return f?.apply(o, a); };
  };
  wrap(world, 'addHitstop', (v) => { t.hitstop = Math.max(t.hitstop, v || 0); });
  wrap(world, 'setTimeScale', (v) => { t.scale.push(v); });
  wrap(engine, 'punch', (v) => { t.punch = Math.max(t.punch, v || 0); });
  wrap(engine, 'flash', (v) => { t.flash = Math.max(t.flash, v || 0); });
  wrap(engine, 'rumble', (s) => { t.rumble = Math.max(t.rumble, s || 0); });
  for (const k of ['tone', 'noise', 'bodyThump', 'thud', 'explosion']) wrap(audio, k, () => { t.sounds++; });
  for (const k of ['sparkBurst', 'cutFlare', 'explosion']) wrap(world.particles, k, () => { t.particles++; });
  wrap(world.player?.camera, 'addShake', (v) => { t.shake = Math.max(t.shake, v || 0); });
  t.stop = () => { for (let i = undo.length - 1; i >= 0; i--) undo[i](); undo.length = 0; };
  return t;
}

export async function run({ check, assert }) {
  /* ── 0. a kill is an event ──────────────────────────────────────────── */

  check('feel: killing something does not feel like wounding it', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { snapshotShared, restoreShared } = await import('./_shared.mjs');
    const { Engine } = await import('../../src/engine/Engine.js');
    const { audio } = await import('../../src/engine/Audio.js');
    const snap = await snapshotShared();
    try {
      const rows = [];
      const felt = {};
      for (const lethal of [false, true]) {
        const { world, engine } = await bootWorld({ level: 'colosseum' });
        // The stub engine carries the members World reached for when it was
        // written. The three new ones come off the SHIPPED prototype rather
        // than being re-declared here — the same rule `_coop.stubEngine`
        // already applies to `lightUp`, and for the same reason: a second copy
        // of a rule beside the real one is HANDOFF §2.4.
        engine._punch = 0;
        engine.punch = Engine.prototype.punch;
        engine.setDrain = Engine.prototype.setDrain;
        engine.setBars = Engine.prototype.setBars;
        const e = world.spawnEnemy('b1', new THREE.Vector3(3, 0, -3));
        assert(e, 'no b1 spawned');
        // The SAME blow both times. The only difference is how much health was
        // left in front of it, which is exactly the difference the audit says
        // the game cannot see. Arm, strike, disarm — no await between them.
        e.hp = lethal ? 1 : 1e6;
        const t = tape(world, engine, audio);
        e.damage(40, e.position.clone(), world.player, 'saber');
        t.stop();
        felt[lethal ? 'kill' : 'wound'] = t;
        rows.push(`${lethal ? 'kill ' : 'wound'} hitstop ${t.hitstop.toFixed(3)}s shake ${t.shake.toFixed(2)}`
          + ` punch ${t.punch.toFixed(2)} sounds ${t.sounds} scale [${t.scale.join(',') || '—'}]`);
        world.unload?.();
      }
      const k = felt.kill, w = felt.wound;
      assert(k.hitstop > w.hitstop,
        `hitstop identical: wound ${w.hitstop}, kill ${k.hitstop}`);
      assert(k.punch > 0 && w.punch === 0,
        `the frame answers a kill the same as a wound: wound punch ${w.punch}, kill ${k.punch}`);
      assert(k.sounds > w.sounds,
        `the dying body made no sound of its own: wound ${w.sounds} sounds, kill ${k.sounds}`);
      assert(k.shake > w.shake, `shake identical: ${w.shake} vs ${k.shake}`);
      // …and the last body on the field bends the clock, which `setTimeScale`
      // had two callers for before this and both of them were Force Sense.
      assert(k.scale.length > 0 && k.scale[0] < 1,
        `the last enemy dying did not move the world clock (${k.scale.join(',') || 'no calls'})`);
      return rows.join('; ');
    } finally { restoreShared(snap); }
  });

  /**
   * A LEVEL LOAD IS A FROZEN TAB.
   *
   * `deploy()` calls the whole build synchronously — heightfield, Rapier world,
   * instanced fields, textures, up to 341 statics — with no yield and nothing
   * on screen. The menu disappears and the page stops answering, which is
   * indistinguishable from a crash. The boot sequence already does this
   * properly, in eleven awaited steps behind a bar.
   */
  check('feel: a level load yields, and the async door builds the same world', async () => {
    const { stubEngine } = await import('./_coop.mjs');
    const { snapshotShared, restoreShared } = await import('./_shared.mjs');
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    const snap = await snapshotShared();
    try {
      await initPhysics();
      const world = new World(await stubEngine(), { ...DEFAULT_SETTINGS, quality: 'low' });

      /* SAME WORLD OUT OF BOTH DOORS. The two paths share one list of stages,
       * so this cannot drift — but "cannot drift" is what every duplicated
       * table in this codebase's history was said to be, so it is measured. */
      world.loadLevel('alpine');
      const sync = { statics: world.statics.length, props: world.props.length,
        terrain: !!world.terrain, grass: !!world.grass, key: world.levelKey,
        director: world.director?.constructor?.name, running: world.running };

      const seen = [];
      let last = 0;
      const cost = [];
      await world.loadLevelAsync('alpine', {}, (frac, name) => {
        const now = performance.now();
        // The callback fires BEFORE its stage runs, so each tick times the
        // stage that came before it. Attributing it to the label being
        // announced is off by one and would blame the wrong stage.
        if (seen.length) cost.push([seen[seen.length - 1].name, now - last]);
        seen.push({ frac, name });
        last = now;
      });
      const async_ = { statics: world.statics.length, props: world.props.length,
        terrain: !!world.terrain, grass: !!world.grass, key: world.levelKey,
        director: world.director?.constructor?.name, running: world.running };
      for (const k of Object.keys(sync)) {
        assert(sync[k] === async_[k], `the async load built a different world: ${k} ${sync[k]} vs ${async_[k]}`);
      }
      assert(seen.length >= 6, `only ${seen.length} progress ticks — that is not a bar, it is a spinner`);
      assert(seen[0].frac === 0 && seen[seen.length - 1].frac === 1,
        `progress ran ${seen[0].frac} → ${seen[seen.length - 1].frac}`);
      for (let i = 1; i < seen.length; i++) {
        assert(seen[i].frac > seen[i - 1].frac, `progress went backwards at ${seen[i].name}`);
        assert(seen[i].name && seen[i].name !== seen[i - 1].name, `an unnamed or repeated stage: ${seen[i].name}`);
      }
      /* THE TIMINGS ARE REPORTED AND NOT ASSERTED ON. Which stage dominates
       * depends on what else is on the box — HANDOFF §2.6 — and on which level
       * was standing before this one: measured here at 75%, 95% and 60% on
       * three runs of the same code, because `unload()` is disposing whatever
       * the previous check left built. A bar on that ratio is a bar on the
       * machine. What IS a property of the game, and is asserted above, is
       * that the load is eight NAMED stages with a yield between each and that
       * both doors build the same world. */
      const total = cost.reduce((a, [, t]) => a + t, 0);
      const worst = cost.reduce((a, b) => (b[1] > a[1] ? b : a), ['—', 0]);
      assert(total > 0, 'the load took no measurable time — nothing was built');

      world.unload();
      return `${seen.length - 1} named stages + ready, 0→1 monotone, same world both doors `
        + `(${sync.statics} statics, ${sync.props} props, ${sync.director}); `
        + `worst stage "${worst[0]}" ${worst[1].toFixed(0)} ms of ${total.toFixed(0)} ms`;
    } finally { restoreShared(snap); }
  });

  check('feel: the jump lens kick reaches the screen, and on the game clock', () => {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 900);
    const rig = new CameraRig(cam);
    const body = new THREE.Vector3(0, 0, 0);
    const ctx = {};
    const run = (frames, dt, write) => {
      let peak = 0;
      for (let i = 0; i < frames; i++) {
        // `Player._updateCamera` ASSIGNS fovTarget from the speed term on every
        // frame. That is the whole reason the old kick never arrived, so the
        // probe has to do it too or it would measure a world that does not
        // exist. Same expression, same place in the frame.
        if (write) rig.fovTarget = 60;
        rig.update(dt, body, ctx);
        peak = Math.max(peak, cam.fov);
      }
      return peak;
    };
    run(30, 1 / 60, true);
    const rest = cam.fov;
    // A jump, with the per-frame assignment running exactly as the game does it.
    rig.kickFov(6, 0.18);
    const peak = run(14, 1 / 60, true);
    assert(peak > rest + 4.5,
      `the kick reached ${(peak - rest).toFixed(2)} deg of 6 — it is being overwritten by the speed term`);
    // …and it goes away, without a timer.
    run(90, 1 / 60, true);
    assert(Math.abs(cam.fov - rest) < 0.15, `the kick never came back down (${cam.fov.toFixed(2)} vs ${rest.toFixed(2)})`);
    assert(!rig.fovKick, 'the kick is still armed');

    /* AND IT IS THE GAME'S CLOCK. The old one was a `setTimeout(…, 180)`, so
     * inside a Force Sense at 0.42x it expired in 76 ms of game time — before
     * the jump it decorates had visibly started — and behind a pause card it
     * expired behind the pause card. Driven at 0.42x here, it has to last
     * about 1/0.42 as many frames. */
    const framesAt = (scale) => {
      rig.fov = 60; rig.fovTarget = 60;
      rig.kickFov(6, 0.18);
      let n = 0;
      while (rig.fovKick && n < 400) { rig.fovTarget = 60; rig.update((1 / 60) * scale, body, ctx); n++; }
      return n;
    };
    const fast = framesAt(1), slow = framesAt(0.42);
    assert(slow > fast * 2, `a 0.42x world spent ${slow} frames on the kick against ${fast} at full speed`);
    return `+${(peak - rest).toFixed(2)} deg of 6 through the per-frame fovTarget write, back to `
      + `${cam.fov.toFixed(1)} with no timer; ${fast} frames at 1x, ${slow} at 0.42x `
      + `(a setTimeout would be ${fast} either way)`;
  });

  check('feel: dying is not the sound of a button you cannot afford', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { snapshotShared, restoreShared } = await import('./_shared.mjs');
    const { Engine } = await import('../../src/engine/Engine.js');
    const { audio } = await import('../../src/engine/Audio.js');
    const snap = await snapshotShared();
    try {
      const { world, engine } = await bootWorld({ level: 'colosseum' });
      let drain = 0, bars = 0;
      engine.setDrain = (v) => { drain = v; };
      engine.setBars = (v) => { bars = v; };
      engine.rumble = () => { engine._rumbled = true; };
      engine.punch = Engine.prototype.punch; engine._punch = 0;
      const p = world.player;
      const rig = p.camera;
      const before = { yaw: rig.yaw, dist: rig.targetDistance, height: rig.height,
        shoulder: rig.shoulderAt };
      // What was actually played, and by name. `ui` is the menu blip the moment
      // used to be; a death that still reaches it has not been fixed.
      const said = [];
      const undo = [];
      for (const k of ['ui', 'death', 'tone', 'noise', 'duckMusic']) {
        const f = audio[k];
        undo.push(() => { audio[k] = f; });
        audio[k] = (...a) => { said.push(k); return f.apply(audio, a); };
      }
      p.die('probe');
      for (const u of undo) u();
      assert(said.includes('death'), `nothing played death(): ${said.join(',') || 'silence'}`);
      assert(!said.includes('ui'), 'the death still routes through the menu blip audio.ui()');
      assert(drain > 0.4, `the colour did not leave the frame (drain ${drain})`);
      assert(bars > 0, `no letterbox (${bars})`);
      assert(world.targetTimeScale < 0.6,
        `the world did not slow for the death (timeScale ${world.targetTimeScale})`);
      assert(rig.shot, 'no death shot — the camera stayed over the shoulder of a corpse');

      // …and it MOVES. Drive the real rig through the real update for two
      // game-seconds and measure where the camera went, rather than asserting
      // that a script exists.
      const ctx = { physics: world.physics, terrain: world.terrain, time: 0 };
      for (let i = 0; i < 120; i++) p._updateDead(1 / 60, ctx);
      const moved = {
        yaw: Math.abs(rig.yaw - before.yaw), dist: rig.targetDistance - before.dist,
        height: rig.height - before.height, shoulder: Math.abs(rig.shoulderAt) };
      assert(moved.yaw > 0.25, `the camera never came round the body (${moved.yaw.toFixed(3)} rad)`);
      assert(moved.dist > 1, `the boom never pulled back (${moved.dist.toFixed(2)} m)`);
      assert(moved.height > 0.35, `the camera never rose (${moved.height.toFixed(2)} m)`);
      assert(moved.shoulder < before.shoulder * 0.5,
        `still framed over the shoulder (${moved.shoulder.toFixed(3)} m of ${before.shoulder})`);

      // Giving the rig back is the other half: co-op revives without any screen
      // closing, and a revived player must not play on grey and letterboxed.
      p.respawn(p.position.clone());
      assert(!rig.shot && drain === 0 && bars === 0 && world.targetTimeScale === 1,
        `respawn left the death on: shot ${!!rig.shot} drain ${drain} bars ${bars} scale ${world.targetTimeScale}`);
      const out = `played ${[...new Set(said)].join('+')}; drain 0.72, bars 0.085, clock ${'0.34'}; `
        + `camera +${moved.yaw.toFixed(2)} rad, +${moved.dist.toFixed(2)} m back, `
        + `+${moved.height.toFixed(2)} m up, shoulder ${before.shoulder.toFixed(2)}→${moved.shoulder.toFixed(2)} m; respawn clears all four`;
      world.unload?.();
      return out;
    } finally { restoreShared(snap); }
  });

  check('feel: a boss walking in is a shot, and the frame lets go of it by itself', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { snapshotShared, restoreShared } = await import('./_shared.mjs');
    const { Engine } = await import('../../src/engine/Engine.js');
    const { audio } = await import('../../src/engine/Audio.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const snap = await snapshotShared();
    try {
      const { world, engine } = await bootWorld({ level: 'colosseum' });
      let bars = 0;
      engine.setBars = (v) => { bars = v; };
      engine.punch = Engine.prototype.punch; engine._punch = 0;
      const boss = Object.keys(ARCHETYPES).find(k => ARCHETYPES[k].boss);
      assert(boss, 'no archetype on the roster declares itself a boss');

      // A rank-and-file body first: it must get NONE of this, or the effect is
      // a filter rather than an entrance.
      const t0 = tape(world, engine, audio);
      world.spawnEnemy('b1', new THREE.Vector3(9, 0, -9));
      t0.stop();
      assert(bars === 0 && t0.punch === 0,
        `a B1 walking in framed the shot (bars ${bars}, punch ${t0.punch})`);

      const t1 = tape(world, engine, audio);
      world.spawnEnemy(boss, new THREE.Vector3(12, 0, -12));
      t1.stop();
      assert(bars > 0, `${boss} arrived with no letterbox`);
      assert(t1.punch > 0, `${boss} arrived with no punch on the frame`);
      assert(t1.sounds > 0, `${boss} arrived in silence`);
      assert(world.targetTimeScale < 1, `the world did not dip for ${boss} (${world.targetTimeScale})`);
      const held = bars;

      /* AND IT LETS GO ON THE WORLD'S CLOCK. A `setTimeout` would release the
       * bars behind a pause card and, at 0.5x, three seconds early. Driven
       * here through the real `world.update`, which is the only thing that
       * advances it. */
      const input = idleInput();
      for (let i = 0; i < 60; i++) world.update(1 / 60, input);
      assert(bars === held, `the bars let go after 1 s (${bars})`);
      for (let i = 0; i < 180; i++) world.update(1 / 60, input);
      assert(bars === 0, `the bars were still up after 4 s (${bars})`);
      assert(world.targetTimeScale === 1, `the world never came back to speed (${world.targetTimeScale})`);
      const out = `B1 → nothing; ${boss} → bars ${held}, punch ${t1.punch.toFixed(2)}, `
        + `${t1.sounds} sounds, clock dipped; both released by world.update, not a timer`;
      world.unload?.();
      return out;
    } finally { restoreShared(snap); }
  });

  check('feel: the two feel toggles reach every new channel', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { snapshotShared, restoreShared } = await import('./_shared.mjs');
    const { Engine } = await import('../../src/engine/Engine.js');
    const { audio } = await import('../../src/engine/Audio.js');
    const { applyFeelSettings, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const snap = await snapshotShared();
    try {
      const { world, engine } = await bootWorld({ level: 'colosseum' });
      engine._punch = 0;
      engine.punch = Engine.prototype.punch;
      applyFeelSettings(world, { ...DEFAULT_SETTINGS, shake: false, slowmo: false });
      const e = world.spawnEnemy('b1', new THREE.Vector3(3, 0, -3));
      e.hp = 1;
      const t = tape(world, engine, audio);
      e.damage(40, e.position.clone(), world.player, 'saber');
      t.stop();
      assert(t.punch === 0, `the screen punched with shake off (${t.punch})`);
      assert(t.rumble === 0, `the pad ran with shake off (${t.rumble})`);
      assert(world.hitstop === 0, `hitstop ran with slowmo off (${world.hitstop})`);
      assert(world.targetTimeScale === 1,
        `kill-time ran with slowmo off (targetTimeScale ${world.targetTimeScale})`);
      // The body still makes its noise: a toggle called "camera shake" must not
      // be able to silence the world.
      assert(t.sounds > 0, 'the toggles took the death sound with them');
      const out = `shake off → punch 0, pad 0; slowmo off → hitstop 0, scale 1; ${t.sounds} sounds still played`;
      world.unload?.();
      return out;
    } finally { restoreShared(snap); }
  });

  /* ── 1. one owner for the ready guard ───────────────────────────────── */

  check('feel: readyX/readyY are assigned in exactly one file', async () => {
    // Commit 2e23892 lowered readyY from 0.30 to 0.08 to answer "the cursor
    // feels way too high", and Player._applyViewMode set it straight back —
    // the fix shipped and was undone in the same build, one file away. There is
    // now one door onto these two numbers (setViewMode) and this is the check
    // that keeps it that way.
    const files = await sources();
    const offenders = [];
    for (const [path, text] of files) {
      if (path === 'game/SaberController.js') continue;
      // an assignment, not a comparison and not a read
      for (const m of text.matchAll(/\bready([XY])\s*=(?!=)/g)) {
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${path}:${line} sets ready${m[1]}`);
      }
    }
    assert(!offenders.length,
      `ready pose set outside SaberController: ${offenders.join(', ')} — it has one owner, READY_GUARD`);
    const scanned = files.length;
    return `${scanned} source files scanned, 0 outside SaberController.js`;
  });

  check('feel: the blade cursor rests near screen centre in BOTH views', () => {
    // Run Player's real _applyViewMode over a real controller, both ways.
    const rows = [];
    for (const fp of [false, true]) {
      const c = new SaberController();
      const stub = { camera: { firstPerson: fp, targetDistance: 0 }, rig: { get: () => null }, control: c };
      Player.prototype._applyViewMode.call(stub);
      const up = c.readyY * c.maxPitch * DEG, right = c.readyX * c.maxYaw * DEG;
      // 22.0 deg is what 0.30 gave and what the player complained about; 10 is
      // the ceiling movement.mjs already holds the constructor to.
      assert(up < 10, `${fp ? 'first' : 'third'} person rests the cursor ${up.toFixed(1)} deg above centre`);
      const want = fp ? READY_GUARD.first : READY_GUARD.third;
      assert(c.readyX === want.x && c.readyY === want.y,
        `${fp ? 'first' : 'third'} person got (${c.readyX}, ${c.readyY}), READY_GUARD says (${want.x}, ${want.y})`);
      rows.push(`${fp ? '1st' : '3rd'} ${up.toFixed(1)} deg up / ${right.toFixed(1)} deg right`);
    }
    // and it must survive the drift home, which is what the player actually sees
    const c = new SaberController();
    const stub = { camera: { firstPerson: false, targetDistance: 0 }, rig: { get: () => null }, control: c };
    Player.prototype._applyViewMode.call(stub);
    c.gx = 0; c.gy = 0;
    const input = { mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
      bindings: defaultBindings(), act: () => false, actHit: () => false };
    for (let i = 0; i < 120; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
    const settled = c.gy * c.maxPitch * DEG;
    assert(settled < 10, `after 2 s of no input the cursor settles ${settled.toFixed(1)} deg high`);

    // ── and READY_GUARD is what NEUTRAL means under the directional scheme.
    //
    // Directional blocking replaced the continuous guard POSITION with four
    // discrete zones, so it would have been easy for the ready pose to quietly
    // stop being anything: it is now where the blade rests with no guard
    // raised, which makes it the pose a player looks at for most of a fight.
    // Same two numbers, same one owner, and the check that keeps it that way is
    // the same check.
    const d = new SaberController({ scheme: 'directional' });
    Player.prototype._applyViewMode.call(
      { camera: { firstPerson: false, targetDistance: 0 }, rig: { get: () => null }, control: d });
    const dInput = { mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
      bindings: defaultBindings(), _held: new Set(),
      act(id) { return this._held.has(id); }, actHit: () => false };
    dInput._held.add('blade');
    for (let i = 0; i < 60; i++) d.applyInput(dInput, 1 / 60, { stamina: 1 });
    assert(d.zone !== 'none', 'setup: the directional guard never came up, so nothing was left');
    const raisedUp = d.gy * d.maxPitch * DEG;
    dInput._held.delete('blade');
    for (let i = 0; i < 90; i++) d.applyInput(dInput, 1 / 60, { stamina: 1 });
    assert(Math.abs(d.gx - d.readyX) < 0.02 && Math.abs(d.gy - d.readyY) < 0.02,
      `dropping the guard left the cursor at (${d.gx.toFixed(3)}, ${d.gy.toFixed(3)}) `
      + `instead of the ready guard (${d.readyX}, ${d.readyY})`);
    const neutral = d.gy * d.maxPitch * DEG;
    assert(neutral < 10, `directional neutral rests the cursor ${neutral.toFixed(1)} deg above centre`);
    return `${rows.join(', ')}; settles at ${settled.toFixed(1)} deg; `
      + `directional guard up ${raisedUp.toFixed(1)} deg → released ${neutral.toFixed(1)} deg`;
  });

  /* ── 2. the catch gate is graded in the body's frame ────────────────── */

  check('feel: walking is not a swing — a rigid wrist never reads as driven', () => {
    // Player.js: base 4.6 m/s, x1.62 sprinting, x0.48 crouched. The gate is
    // 3.2 m/s of blade speed or 1.6 m/s of closing, so in the world frame every
    // gait above a crouch cleared it on translation alone.
    const rows = [];
    for (const [name, speed] of [['stand', 0], ['crouch', 4.6 * 0.48], ['walk', 4.6], ['sprint', 4.6 * 1.62]]) {
      const snap = drive({ speed });
      // what the same contact read before, carrier still in the numbers
      const world = snap.bladeVel.clone().add(new THREE.Vector3(0, 0, -speed));
      const worldCaught = world.length() > 3.2 || -world.dot(snap.boltDir) > 1.6;
      assert(!snap.caught && !snap.driven,
        `a rigid wrist at ${speed.toFixed(2)} m/s graded as a driven blade `
        + `(${snap.bladeSpeed.toFixed(2)} m/s, closing ${snap.closing.toFixed(2)})`);
      // …and prove this is catching something real rather than passing because
      // the setup never moved: at walking pace and above, the world frame this
      // replaces really did clear the gate on translation alone.
      if (speed > 3.2) assert(worldCaught,
        `setup: at ${speed.toFixed(2)} m/s the old world-frame reading should have caught, `
        + `it read ${world.length().toFixed(2)} m/s — the check proves nothing`);
      rows.push(`${name} ${speed.toFixed(1)}→body ${snap.bladeSpeed.toFixed(2)} m/s`
        + (worldCaught ? ` (world would say ${world.length().toFixed(2)}, caught)` : ''));
    }
    return rows.join('; ');
  });

  check('feel: a flick still catches, and reads the same standing as at a sprint', () => {
    const still = drive({ flickAt: 120 });
    const running = drive({ speed: 4.6 * 1.62, flickAt: 120 });
    assert(still.caught && still.driven,
      `a real flick graded ${still.bladeSpeed.toFixed(2)} m/s — under the 3.2 m/s gate, so nothing can be caught at all`);
    assert(running.caught && running.driven,
      `the same flick at a sprint graded ${running.bladeSpeed.toFixed(2)} m/s and was not caught`);
    // The whole point of the body frame: your gait must not change the grade.
    const drift = Math.abs(still.bladeSpeed - running.bladeSpeed);
    assert(drift < 0.05,
      `the same wrist graded ${still.bladeSpeed.toFixed(2)} m/s standing and `
      + `${running.bladeSpeed.toFixed(2)} m/s sprinting — a ${drift.toFixed(2)} m/s difference the player did not make`);
    return `flick ${still.bladeSpeed.toFixed(2)} m/s standing, ${running.bladeSpeed.toFixed(2)} m/s sprinting `
      + `(gate 3.2), difference ${drift.toFixed(3)}`;
  });

  /* ── 3. the cone travels with the body ──────────────────────────────── */

  check('feel: the auto-guard cone follows the chest instead of staying behind', () => {
    const dt = 1 / 60, speed = 4.6 * 1.62;
    const inc = new THREE.Vector3(0, 0, 1);        // bolts fly +Z, the player walks -Z
    const trial = (follow) => {
      const chest = new THREE.Vector3(0, 1.35, 0);
      const cw = new CatchWindow();
      cw.add({ b: 1 }, { manual: true, chest, incoming: inc });
      if (!follow) cw.anchor = null;               // reproduce the frozen origin
      let covered = 0, total = 0, drift = 0;
      for (let f = 0; f < 60; f++) {
        chest.z -= speed * dt;
        cw.update(dt, false);
        const g = cw.guard();
        if (!g) break;
        drift = g.origin.distanceTo(chest);
        // a bolt 2 m out in front of the CURRENT chest, arriving now
        const from = chest.clone().addScaledVector(inc, -2.0);
        const to = chest.clone().addScaledVector(inc, -1.2);
        total++;
        if (guardIntercept(from, to, g)) covered++;
      }
      return { covered, total, drift };
    };
    const now = trial(true), then = trial(false);
    assert(now.drift < 1e-6,
      `the cone origin is ${now.drift.toFixed(2)} m from the chest it belongs to`);
    assert(now.covered === now.total,
      `only ${now.covered} of ${now.total} head-on bolts were inside a cone that was open the whole time`);
    // and the failure it replaces really was a failure, so this cannot pass vacuously
    assert(then.drift > CATCH.autoRadius,
      `setup: a frozen origin should drift past the ${CATCH.autoRadius} m radius, it moved ${then.drift.toFixed(2)} m`);
    return `following: 0.00 m drift, ${now.covered}/${now.total} covered; `
      + `frozen: ${then.drift.toFixed(2)} m drift, ${then.covered}/${then.total} covered`;
  });

  /* ── 4. only a driven catch re-arms the cone ────────────────────────── */

  check('feel: a catch the player did not drive cannot re-arm the cone', () => {
    // The rule CATCH.autoGuard's comment leans on is "an AUTO catch does not
    // re-open the cone, only a manual one does", and callers set `manual` from
    // which MECHANISM caught the bolt rather than from whether the blade was
    // driven. Those are different claims, and the gap between them was the
    // hold-to-win chain: measured on the real path, a rigid wrist carried at a
    // crouch-walk answered 19 bolts "by hand" in 10 s and held the cone open
    // for 64% of them. With the snapshot present the window checks it.
    const chest = new THREE.Vector3(0, 1.35, 0);
    const inc = new THREE.Vector3(0, 0, 1);
    const mk = (driven, auto) => ({ bolt: {}, snap: { driven, auto, caught: driven || auto } });

    const carried = new CatchWindow();
    carried.add(mk(false, false), { manual: true, chest, incoming: inc });
    assert(!carried.guard(),
      'a bolt that merely met a blade being carried past it re-opened the auto-guard cone');

    const free = new CatchWindow();
    free.add(mk(false, true), { manual: false, chest, incoming: inc });
    assert(!free.guard(), 'an auto-guard catch re-opened the auto-guard cone — one deflect covers a whole stream');

    const drivenCw = new CatchWindow();
    drivenCw.add(mk(true, false), { manual: true, chest, incoming: inc });
    assert(drivenCw.guard(), 'a genuinely driven catch failed to open the cone at all');
    assert(Math.abs(drivenCw.auto - CATCH.autoGuard) < 1e-9,
      `a driven catch opened the cone for ${drivenCw.auto} s, not ${CATCH.autoGuard} s`);

    // …and it still cannot be pushed past its budget by free catches after it
    let t = 0;
    for (let f = 0; f < 600; f++) {
      if (f % 6 === 0 && drivenCw.guard()) drivenCw.add(mk(false, true), { manual: false, chest, incoming: inc });
      drivenCw.update(1 / 60, false);
      if (drivenCw.guard()) t += 1 / 60;
    }
    assert(t <= CATCH.autoGuard + 1e-6,
      `free catches stretched one cone to ${t.toFixed(2)} s against a ${CATCH.autoGuard} s budget`);
    return `carried→shut, free→shut, driven→${CATCH.autoGuard} s; `
      + `10 s of free catches bought ${(t * 1000).toFixed(0)} ms total`;
  });

  /* ── 5. every control is a real, rebindable action ──────────────────── */

  check('feel: every action the game reads exists in ACTIONS', async () => {
    // `stance` and `flourish` were seeded into input.bindings at runtime and
    // `stasis`/`rend` were read off hardcoded key codes, so four controls never
    // reached the table: no options row, no rebind, and no way for findConflict
    // to warn that something else already wanted the key.
    const files = await sources();
    const used = new Map();
    for (const [path, text] of files) {
      for (const m of text.matchAll(/\.act(?:Hit)?\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        if (!used.has(m[1])) used.set(m[1], path);
      }
    }
    const missing = [...used].filter(([id]) => !ACTION_IDS.includes(id));
    assert(!missing.length,
      `read but never registered: ${missing.map(([id, p]) => `${id} (${p})`).join(', ')}`);
    // And nothing may quietly install a binding at runtime. Three files are
    // allowed to write one: Bindings.js defines and persists them, Input.js
    // holds the live set, and the options screen rebinds them because the
    // player asked it to. Gameplay never does — that is how `stance` came to
    // exist on a key the player could neither see nor change.
    const OWNERS = ['engine/Bindings.js', 'engine/Input.js', 'ui/Menu.js'];
    const seeded = [];
    for (const [path, text] of files) {
      if (OWNERS.includes(path)) continue;
      if (/\bbindings\s*(\.[A-Za-z0-9_]+|\[[^\]]+\])\s*=(?!=)/.test(text)
          || /\bb\.(stance|flourish|stasis|rend)\s*=(?!=)/.test(text)) seeded.push(path);
    }
    assert(!seeded.length, `bindings written at runtime by gameplay in: ${seeded.join(', ')}`);
    return `${used.size} distinct actions read across ${files.length} files, all registered, none seeded`;
  });

  check('feel: lateral guard, flourish and the attack rose are on keys nothing else claims', async () => {
    const b = defaultBindings();
    // attackOver/attackStab join the list for the same reason the other four
    // are on it: they were the WHEEL, which had never been in a table at all —
    // read raw by the wrist roll and raw again by the Force grip, with the grip
    // having to steal the device frame by frame because neither could see the
    // other. A control that is not in ACTIONS cannot be seen to collide.
    for (const id of ['stance', 'flourish', 'stasis', 'rend', 'attackOver', 'attackStab']) {
      const a = ACTIONS.find(x => x.id === id);
      assert(a, `${id} is not in ACTIONS at all — it cannot be rebound or even found`);
      assert(b[id] && b[id].length, `${id} has no default key`);
    }
    assert(ACTIONS.find(x => x.id === 'stance').hold,
      'a guard stance is something you hold, and it is not marked hold');

    // Nothing else in ACTIONS may want these keys…
    const clashes = [];
    for (const id of ['stance', 'flourish', 'attackOver', 'attackStab']) {
      for (const k of b[id]) {
        const other = findConflict(b, k, id);
        if (other) clashes.push(`${id} shares ${k} with ${other}`);
      }
    }
    assert(!clashes.length, clashes.join(', '));

    // …and neither may the systems that read raw key codes past the bindings
    // table, which is where the old KeyB/KeyN seeding actually hurt: in the
    // dojo, one press stepped the lesson AND fired a Force power AND moved the
    // blade. main.js is scanned rather than trusted so this cannot go stale.
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const raw = new Set([...main.matchAll(/\.code\s*===\s*['"]([A-Za-z0-9]+)['"]/g)].map(m => m[1]));
    const stolen = [];
    for (const id of ['stance', 'flourish', 'attackOver', 'attackStab']) {
      for (const k of b[id]) if (raw.has(k)) stolen.push(`${id} on ${k}`);
    }
    assert(!stolen.length,
      `${stolen.join(', ')} — main.js reads that code directly, so one press does two things`);
    return `stance ${b.stance.join('+')}, flourish ${b.flourish.join('+')}, `
      + `attacks ${b.attackOver.join('+')}/${b.attackStab.join('+')}; `
      + `main.js claims ${[...raw].join(',') || 'nothing'} raw, no overlap`;
  });
}
