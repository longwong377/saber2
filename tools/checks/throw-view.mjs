/**
 * BATTLEFRONT BORZ — what a thrown blade does to the picture.
 *
 * THE BUG. The player reported "condensation/blur in front of the camera on
 * saber throw and recall". It is the heat haze, and it was not being emitted by
 * a hot blade near the lens — it was being emitted by a PROJECTILE flying
 * through the shot.
 *
 * `Player._updateBlade` ends with a haze keyed off `saber.swingSpeed`, gated at
 * `swing > 9` so a blade at rest does not smear the middle of the screen. That
 * gate is about a HELD blade. `swingSpeed` is the hilt's own speed through the
 * world, and a saber hurled at 25-30 m/s reports three times what any swing
 * does, for the whole flight — so the throw painted a haze wherever the blade
 * was, and the recall brought it straight down the view axis and grew it as it
 * came, which is exactly what a smear on the lens looks like.
 *
 * Two gates, and the second one matters on its own. The effect is a screen-space
 * blob 70-120 mm of NDC across; within about a metre of the lens the blade
 * subtends more than that, so it stops reading as air over something hot and
 * starts reading as a dirty lens. Anything that comes at the camera — a
 * recalled saber, a blade knocked out of your hand — has to stop.
 *
 * Both checks fail on the tree they were written against.
 */

import { Player } from '../../src/game/Player.js';

let THREE = null;

function stubWorld(heat) {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: true, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat: (...a) => heat.push(a), camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {},
  };
}

function stubInput() {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    // the blade action HELD, the way viewmodel.mjs drives it: without it the
    // controller never swings and there is no heat to measure either way.
    act: (id) => id === 'blade', actHit: () => false,
  };
}

/** Swing hard for a while, then throw, and count the haze in each phase. */
function throwRun({ frames = 300, firstPerson = false } = {}) {
  const heat = [];
  const world = stubWorld(heat);
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
  p.saber.ignite(); p.saber.ignition = 1;
  const input = stubInput();
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  const phases = { held: 0, flying: 0, returning: 0 };
  let thrown = false;
  for (let i = 0; i < frames; i++) {
    ctx.time = world.time = i / 60;
    input.buttons[0] = i < 140;
    input.mouse.dx = i < 140 ? Math.cos(i / 14) * -44 : 0;
    input.mouse.dy = i < 140 ? Math.sin(i / 14) * -30 : 0;
    if (i === 150 && !thrown) { p.force = 100; p.cooldowns.throw = 0; p.throwOrRecall(ctx); thrown = p.throwState !== 'held'; }
    const before = heat.length;
    p.update(1 / 60, ctx);
    const emitted = heat.length - before;
    if (phases[p.throwState] !== undefined) phases[p.throwState] += emitted;
  }
  return { p, heat, phases, thrown };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('throw: a saber in flight does not smear the lens', async () => {
    /*
     * The count is the assertion. A held blade being swung must still shimmer —
     * that is the effect doing its job, and a check that only said "no haze"
     * would pass on a build that had deleted it. So both numbers are read: heat
     * while held, which has to be non-zero, and heat while the blade is in the
     * air or coming back, which has to be exactly zero.
     */
    const r = throwRun();
    assert(r.thrown && r.p.throwState !== 'held' || r.phases.flying + r.phases.returning === 0,
      'the throw never left the hand, so this check measured nothing');
    assert(r.phases.held > 0,
      'a blade being swung in the hand throws no heat haze at all — the effect is gone, not gated');
    assert(r.phases.flying === 0 && r.phases.returning === 0,
      `a thrown blade painted ${r.phases.flying} haze blobs in flight and ${r.phases.returning} on the way back — `
      + 'that is a projectile flying through the shot, not heat off a blade');
    return `haze: ${r.phases.held} frames while held, ${r.phases.flying} in flight, ${r.phases.returning} returning`;
  });

  check('throw: nothing hazes the camera from inside a metre of it', async () => {
    /*
     * The second gate, checked against the source rather than by contriving a
     * blade at the lens: `HEAT_NEAR` has to exist, has to be read on the same
     * branch that emits, and has to be far enough out that a first-person hilt
     * — which sits about 0.5 m from the eye — is on the right side of it.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const m = src.match(/const HEAT_NEAR = ([\d.]+);/);
    assert(m, 'HEAT_NEAR is gone — nothing stops the blade hazing the lens from touching distance');
    const near = parseFloat(m[1]);
    assert(near >= 0.4 && near <= 1.2,
      `HEAT_NEAR is ${near} m: under 0.4 it does not cover a blade at the lens, over 1.2 it eats first person's own shimmer`);
    const emit = src.slice(src.indexOf('this.throwState === \'held\' && this.saber.ignition'), src.indexOf('addHeat('));
    assert(/distanceTo\(ctx\.camera\.position\)\s*>\s*HEAT_NEAR/.test(emit),
      'the near-camera cutoff is declared but the emitter does not read it');
    return `heat suppressed inside ${near} m of the lens, and for any blade not in the hand`;
  });
}
