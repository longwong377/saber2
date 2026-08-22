/**
 * BATTLEFRONT BORZ — WHERE EVERY BODY IS, AND WHETHER THE CAMERA CAN SEE IT.
 *
 *   node --import ./tools/register.mjs tools/_linelook.mjs [seed] [level]
 *
 * ── THE QUESTION IT WAS BUILT FOR ───────────────────────────────────────
 *
 * The first plates ever taken of `MODES.theline` show the roster panel reading
 * **10 STANDING** over an empty desert with not one trooper in shot, and the
 * wave counter reading **49 remaining** with not one hostile in shot. Three
 * different defects produce that picture and they want three different fixes:
 *
 *   SPAWN TIMING   the bodies do not exist yet
 *   CULLING / LOD  they exist and are not drawn — `MergedSkin` has swallowed
 *                  them, `Cohorts` has taken them past `L3_AT` (137.8 m), or
 *                  their rigs are not parented to the scene at all
 *   PLACEMENT      they exist, they are drawn, and they are behind the camera
 *
 * A screenshot cannot tell them apart. This does: it prints every body's range
 * and bearing off the camera's own centre line, its LOD rung, whether its rig
 * is in the scene, whether a merged skin or a cohort has it, and whether the
 * RENDERER'S OWN FRUSTUM contains it.
 *
 * ── THE FRUSTUM IS THE RENDERER'S AND THE TRAP IS NaN ───────────────────
 *
 * `stubEngine` builds a real `THREE.PerspectiveCamera(60, 16/9)` and
 * `CameraRig.update` writes it every frame from inside `Player.update`, so the
 * test below is the one the renderer performs and not a cone drawn by hand.
 * Two things had to be got right and both were got wrong first:
 *
 *   STEP ONCE BEFORE ASKING. Before the first `world.update` the rig has not
 *     written the camera, so it sits at the origin looking down −Z and reports
 *     the whole roster in frame.
 *   HAND IT A POSITION, NOT A BODY. `inViewAt(enemy)` puts NaN in the sphere's
 *     centre, and `Frustum.intersectsSphere` rejects on `distance < -radius`,
 *     which is FALSE for NaN — so nothing is ever rejected and ten men standing
 *     171° behind the camera read as visible. It printed `10 of 10 in frame`
 *     and it was completely wrong. HANDOFF §2.5: re-run clean before believing
 *     a result, especially one that flatters.
 *
 * ── WHAT IT MEASURED THE FIRST TIME, seed 5, geonosis ───────────────────
 *
 *     t = 0.03 s   10 alive, 4.0–8.4 m, every one 83°–180° off centre, lod 0,
 *                  0 detached, 0 merged, 0 cohorted —  0 of 10 IN FRAME
 *     t = 10 s      8 alive, 3.5–10.6 m, 121°–180° off —  0 of 8 IN FRAME
 *                  49 hostiles, 30–90 m, 15 in frame, none past L3_AT
 *     t = 30 s      7 alive, 8.3–25.9 m —  1 of 7 IN FRAME
 *
 * So it is PLACEMENT. `DEFAULT_FORMATION` is `behind` — "In column behind you.
 * You are the point of the spear" — whose slot is `z = -(3.0 + rank·2.2)`, and
 * the formation's frame is the commander's held BODY heading (`headingOf`,
 * slewed on a 40° deadband), which at 0:00 agrees with the camera because
 * `Player` opens its rig at `yaw = Math.PI` and nothing on the solo path writes
 * it again. Half the horizontal frame is 45.7° at the shipped `fov: 60` on
 * 16:9. The mode's entire named army is in the half of the world the camera
 * does not cover, on the frame the player first sees it.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const argv = process.argv.slice(2);
const SWEEP = argv.includes('--sweep');
const rest = argv.filter((a) => !a.startsWith('--'));
const SEED = Number(rest[0] || 5);
const LEVEL = rest[1] || 'geonosis';
const AT = (rest[2] || '0,10,30').split(',').map(Number);

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { L3_AT } = await import('../src/game/Cohorts.js');

const { world, engine } = await bootWorld({
  level: LEVEL, spawn: true,
  settings: { mode: 'theline', level: LEVEL, order: 'jedi', instantSpawn: true },
  runSeed: SEED,
});
const d = world.command;
if (!d) throw new Error(`no army on ${LEVEL} — is this the mode you meant?`);
d.start(1);
const input = idleInput();
const STEP = 1 / 30;
const cam = engine.camera;
const frustum = new THREE.Frustum();
const m4 = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.0);

function inViewAt(pos) {
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(m4);
  /* Chest height and a metre of man, not a point at his feet: a body standing
   * on the bottom edge of the frame is on screen. */
  sphere.center.set(pos.x, pos.y + 0.9, pos.z);
  return frustum.intersectsSphere(sphere);
}
const inView = (b) => inViewAt(b.position);

function census(label) {
  const me = world.player.position;
  const yaw = world.player.camera.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const bearing = (b) => {
    const dx = b.position.x - me.x, dz = b.position.z - me.z;
    return Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz) * 180 / Math.PI;
  };
  const range = (b) => Math.hypot(b.position.x - me.x, b.position.z - me.z);
  const team = world.player.team;
  const mine = d.roster.living.map((t) => t.body).filter((b) => b && !b.dead);
  const foes = world.enemies.filter((e) => !e.dead && e.team !== team);
  cam.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

  console.log(`\n== ${label}   camera yaw ${yaw.toFixed(3)}, at `
    + `(${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)}) `
    + `looking (${fwd.x.toFixed(2)}, ${fwd.y.toFixed(2)}, ${fwd.z.toFixed(2)}), fov ${cam.fov}`);
  console.log(`   your line: ${mine.length} alive`);
  for (const b of mine) {
    console.log(`      ${range(b).toFixed(1)} m  ${bearing(b).toFixed(0)}°  lod${b.lod ?? '?'}`
      + `${b.rig?.root ? (b.rig.root.parent ? '' : '  DETACHED') : '  NORIG'}`
      + `${b.rig?.root?.visible === false ? '  INVISIBLE' : ''}`
      + `${b._l3 ? '  COHORT' : ''}${b._l2 ? '  MERGED' : ''}`
      + `${inView(b) ? '  IN FRAME' : ''}`);
  }
  console.log(`   in frame: ${mine.filter(inView).length} of ${mine.length} of yours`);
  const lods = {};
  for (const f of foes) lods[f.lod ?? '?'] = (lods[f.lod ?? '?'] | 0) + 1;
  const ds = foes.map(range).sort((a, b) => a - b);
  console.log(`   hostiles: ${foes.length} alive, ${foes.filter(inView).length} in frame, `
    + `${foes.filter((f) => range(f) > L3_AT).length} past L3_AT (${L3_AT.toFixed(1)} m)`);
  if (foes.length) {
    console.log(`     range min ${ds[0].toFixed(0)} median ${ds[ds.length >> 1].toFixed(0)} `
      + `max ${ds[ds.length - 1].toFixed(0)}   lod ${JSON.stringify(lods)}   `
      + `detached ${foes.filter((f) => f.rig?.root && !f.rig.root.parent).length}`);
  }
}

/**
 * ── `--sweep`: WHICH SHIPPED ORDER PUTS THE LINE IN THE FRAME ────────────
 *
 * Every formation measured in ONE world with the wave EMPTIED, so the only
 * variable is the shape. A sweep that let the fight run would measure each
 * order against a field with fewer men on it than the last one had — arms that
 * differ in more than the thing under test (HANDOFF §2.5), and on a quantity
 * that is chaotic to begin with (§2.5b).
 *
 * Six game-seconds to walk to the new slots before the reading is taken.
 * `order()` is the shipped verb — the same one a key press calls — so the
 * planting, the log entry and the HUD indicator happen as they would.
 */
if (SWEEP) {
  const { FORMATIONS, DEFAULT_FORMATION } = await import('../src/game/Command.js');
  d.spawnQueue.length = 0;
  for (const e of world.enemies) if (e.team !== world.player.team) e.dead = true;
  for (const id of Object.keys(FORMATIONS)) {
    d.order(id, d.commander);
    for (let i = 0; i < Math.round(6 / STEP); i++) world.update(STEP, input);
    const me = world.player.position;
    const yaw = world.player.camera.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const bodies = d.roster.living.map((t) => t.body).filter((b) => b && !b.dead);
    const seen = bodies.filter(inView).length;
    const bear = bodies.map((b) => {
      const dx = b.position.x - me.x, dz = b.position.z - me.z;
      return Math.abs(Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz) * 180 / Math.PI);
    }).sort((a, b) => a - b);
    const rng = bodies.map((b) => Math.hypot(b.position.x - me.x, b.position.z - me.z))
      .sort((a, b) => a - b);
    console.log(`${id.padEnd(9)}${id === DEFAULT_FORMATION ? '*' : ' '} `
      + `${String(seen).padStart(2)} of ${bodies.length} in frame   `
      + `|bearing| ${bear[0].toFixed(0)}–${bear[bear.length - 1].toFixed(0)}°   `
      + `range ${rng[0].toFixed(1)}–${rng[rng.length - 1].toFixed(1)} m   ${FORMATIONS[id].name}`);
  }
  world.unload();
} else {
  /* ONE STEP FIRST — see the header. */
  world.update(STEP, input);
  census(`t = ${world.time.toFixed(2)} s, the first stepped frame after Drop`);
  for (const target of AT) {
    if (target <= world.time) continue;
    const n = Math.round((target - world.time) / STEP);
    for (let i = 0; i < n; i++) world.update(STEP, input);
    census(`t = ${target} s`);
  }
  world.unload();
}
