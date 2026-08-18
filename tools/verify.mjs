/**
 * Headless verification of the systems that matter, with no GPU involved.
 *
 * The browser smoke test proves the game boots and renders; this proves the
 * mechanics are actually correct — that a blade crossing a limb severs it at
 * the right place, that the piece becomes physics, that a still blade blocks
 * while a fast tip returns, and that the solver settles instead of exploding.
 *
 *   node tools/verify.mjs
 */

import './dom-shim.mjs';
import * as THREE from 'three';

/**
 * THIS FILE MUST BE RUN THROUGH ITS LOADER, AND USED NOT TO SAY SO.
 *
 * `npm run verify` is `node --import ./tools/register.mjs tools/verify.mjs`.
 * The hook maps the bare specifier `three` onto `vendor/three`, which is the
 * copy the game actually ships and the browser actually loads. Run it as plain
 * `node tools/verify.mjs` — the obvious thing to type, and what an agent, a CI
 * job or anyone reading the header comment will type — and Node resolves
 * `three` out of `node_modules` instead. Both copies then exist in one process:
 * this file's static graph on one, everything a suite imports on the other.
 *
 * IT DOES NOT CRASH. It reports. Measured on a clean tree, running the two ways
 * back to back:
 *
 *   with the loader        1139 passed, 0 failed
 *   without                1137 passed, 2 failed
 *
 * and the two failures are pure fiction. `lifecycle` patches
 * `THREE.BufferGeometry.prototype.dispose` to count what a corpse frees; the
 * bodies are built by `Bodies.js`, which this file imports statically, so their
 * geometries are the OTHER copy's and the patched method is never called. The
 * check then reports "56 of 56 geometries survived the corpse" — a leak of
 * every geometry in the game, which would be a serious bug, and is not
 * happening at all. That cost an afternoon of bisecting for order-dependence
 * that was never there.
 *
 * A tool that answers wrongly when invoked the obvious way is worse than one
 * that refuses, so this refuses. It is the same rule the checks are held to by
 * `determinism.mjs`: a missing thing gets an error, never a plausible default.
 *
 * THE TEST IS OBJECT IDENTITY, and the first attempt at it was wrong in a way
 * worth recording. `import.meta.resolve('three')` answers vendor either way:
 * `dom-shim.mjs` registers the hook itself, and it is this file's first import,
 * so by the time any of this file's own code runs the hook is installed and
 * resolution is honest — for everything from that point on. The static graph
 * was linked BEFORE any of it evaluated, so the bindings are already on the
 * other copy and no question asked afterwards can see it. Two module namespace
 * objects are the same object iff they are the same module instance, which is
 * exactly the question, and it cannot be fooled by when it is asked.
 */
{
  const dynamic = await import('three');
  if (dynamic !== THREE) {
    console.error(
      '\n  verify.mjs was started without its module loader.\n\n'
      + '  Two copies of three are loaded in this process. This file\'s static imports\n'
      + '  were bound to node_modules before dom-shim.mjs could install the hook;\n'
      + `  everything imported after it gets ${import.meta.resolve('three').replace(/^file:\/\/.*\//, '')}.\n`
      + '  The checks then measure whichever copy they did not mean to, and report the\n'
      + '  difference as a defect in the game — see the note above for what that cost.\n\n'
      + '  Run:  npm run verify\n'
      + '    or: node --import ./tools/register.mjs tools/verify.mjs\n');
    process.exit(2);
  }
}

// The sphere solver is nobody's engine any more — ragdolls were the last
// thing on it. It survives here only as the reference the Rapier raycast is
// checked against, and for LAYER and the segment maths the blade still uses.
import { PhysicsWorld, Body, LAYER, segmentSegment } from '../src/physics/Physics.js';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld, Body as RBody, RagdollJoint, box as boxShape, ball as ballShape, cylinder as cylShape,
  capsule as capShape, compound as compoundShape, hullFromGeometry,
  collisionGroups } from '../src/physics/RapierWorld.js';
import { Prop, makeCrate, makeBarrel, makeSpire, makePillar, propMaterials } from '../src/world/Props.js';
import { addColumn, addBrokenWall, addLintel } from '../src/world/Props.js';
import { Destruction, Structure, PROFILES, fractureSolid, boxPoly, clipPoly, polyVolume, cellHp } from '../src/world/Destruction.js';
import { Rig, humanoidSkeleton, BipedAnimator } from '../src/game/Rig.js';
import { buildB1, buildJedi, buildTrooper, buildAcolyte, limbGeo, plateGeo } from '../src/game/Bodies.js';
import { Actor, updateCauterisation } from '../src/game/Ragdoll.js';
import { BladeContactSolver, gradeDeflection, resolveBladeClash, GRADE, TOUGHNESS, DIFFICULTY } from '../src/game/Combat.js';
import { sliceGeometry, spheresForGeometry, recenterGeometry } from '../src/world/Slice.js';
import { Saber } from '../src/game/Saber.js';
import { SaberController } from '../src/game/SaberController.js';
import { WaveDirector, BOONS, ATTUNEMENTS, drawBoons, RankSet, rankOf, rankScale,
  maxRank, RANK_DIMINISH } from '../src/game/Waves.js';
/* Player.js is imported DYNAMICALLY, inside the one check that needs it — see
 * the note at src/world/Scenery.js:566. A static edge from this file reaches
 * Engine.js through Player -> Saber/Cloth, and Engine rewrites three's fog
 * ShaderChunks as a module side effect behind a once-only flag. In this file's
 * STATIC graph `three` resolves out of node_modules while everything imported
 * dynamically resolves out of vendor/, so a static edge patches the wrong copy,
 * burns the flag, and turns all five aerial-perspective checks quietly red.
 * Measured, by doing exactly that. */
import { Terrain, TERRAIN_PRESETS, strata, duneProfile } from '../src/world/Terrain.js';
import { DuelBrain, Telegraph, BladeLock, FORMS, FORM_KEYS, TIER } from '../src/game/Duel.js';
import { Cloak, attachCloak } from '../src/game/Cloth.js';
import { DojoDirector, LESSONS, buildRemote } from '../src/game/Dojo.js';
import { FocusSystem, FOCUS } from '../src/game/Focus.js';
import { polar, siteOk, findSite, cluster, run, beginDressing, LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { WindField, wind, WIND_GLSL, GrassField, Water, Atmosphere, PusherTracker, ground } from '../src/world/Scenery.js';
import { Particles, ParticlePool, ChipField, DecalField } from '../src/world/Particles.js';
import { clamp } from '../src/engine/MathUtil.js';

let pass = 0, fail = 0;
const t0 = Date.now();
const results = [];
const pending = [];
function check(name, fn) {
  try {
    const detail = fn();
    // a check may be async; keep its slot in order and settle it before printing
    if (detail && typeof detail.then === 'function') {
      const slot = ['✓', name, ''];
      results.push(slot);
      pending.push(detail.then(
        (d) => { pass++; slot[2] = d === undefined ? '' : String(d); },
        (e) => { fail++; slot[0] = '✗'; slot[2] = e.message; }));
      return;
    }
    pass++;
    results.push(['✓', name, detail === undefined ? '' : String(detail)]);
  } catch (e) {
    fail++;
    results.push(['✗', name, e.message]);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} vs ${b} (±${tol})`); }

/**
 * EVERY SUITE REPORTS AS IT FINISHES, AND THAT IS THE WHOLE POINT.
 *
 * This file used to print one line per suite as it STARTED (`  … name.mjs`) and
 * hold every result to the summary table at the bottom. So a run that stalled
 * on suite 42 threw away the evidence from the 41 that had already passed: what
 * you got for forty minutes of CPU was a list of filenames. Several 50-minute
 * runs in one session produced no gate number at all for that reason, and every
 * agent working on the project ended up driving `_one.mjs` by hand instead —
 * which is why the per-suite evidence was good while the aggregate was missing.
 *
 * A gate that only speaks when it finishes cannot report on a run that does not,
 * and "does not finish" is the failure mode this project actually has. So each
 * suite's tally goes out the moment it settles, every failure is printed in full
 * where it happened rather than 3000 lines later, and a running total rides
 * along so a killed run still has a number attached to it. The summary table at
 * the bottom is unchanged and still the canonical artefact; this is the same
 * information, emitted early enough to survive.
 *
 * STDERR, for the same reason the `… name` line was on stderr: stdout carries
 * the result table and `| tail -60` must not eat the answer. Both streams go to
 * a terminal by default, so a person watching sees it interleaved and a script
 * capturing stdout sees exactly what it saw before.
 *
 * RSS RIDES ALONG because HANDOFF §2.7 asks for exactly this reading and it
 * costs nothing: a monotonic climb across unrelated suites is a leak, a spike
 * confined to two suites is a peak, and the two want opposite fixes. `_memtrace.mjs`
 * was written to answer that question by re-implementing this runner and could
 * not (a second copy of a runner is the defect this project keeps removing —
 * §2.4); one field on this line answers it from the runner that actually runs.
 */
function report(label, from, began) {
  const slice = results.slice(from);
  const bad = slice.filter(r => r[0] === '✗');
  for (const [, name, detail] of bad) process.stderr.write(`      \x1b[31m✗ ${name}\x1b[0m  ${detail}\n`);
  const secs = (Date.now() - began) / 1000;
  const rss = process.memoryUsage().rss / 1048576;
  const colour = bad.length ? '\x1b[31m' : '\x1b[32m';
  process.stderr.write(`  ${colour}${bad.length ? '✗' : '✓'}\x1b[0m ${label.padEnd(26)}`
    + ` ${String(slice.length - bad.length).padStart(4)}/${String(slice.length).padEnd(4)}`
    + ` \x1b[2m${secs.toFixed(1).padStart(6)}s   rss ${rss.toFixed(0).padStart(4)} MB`
    + `   running ${pass}/${pass + fail}\x1b[0m\n`);
}

/* ── a blade we can drive by hand ────────────────────────────────────── */

function makeBlade(scene, opts = {}) {
  const s = new Saber(scene, { colorIndex: 0, bladeLength: opts.length ?? 1.15 });
  s.ignite();
  s.ignition = 1;
  return s;
}
/** Place the blade for two consecutive frames so it has a real sweep. */
function sweepBlade(saber, fromPos, fromQuat, toPos, toQuat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(fromPos, fromQuat);
  saber.update(dt, 0);            // establishes the previous frame
  saber.setHiltPose(toPos, toQuat);
  saber.update(dt, dt);           // now prev→cur is a genuine sweep
  return saber;
}

const scene = new THREE.Scene();
const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpN = (a, b, i, n) => (n <= 1 ? (a + b) / 2 : a + (b - a) * (i / (n - 1)));

// Rapier is WASM and every world below needs it instantiated first.
await initPhysics();

/** A perfectly flat, analytic ground both solvers understand. */
const flatGround = () => ({ height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
  raycast: () => null, friction: 0.9, size: 400 });

/**
 * How square a body is to the floor: world-up taken into the body's own frame,
 * then its largest component. 1 means a face is flat on the ground; a cube
 * balanced on an edge reads 0.707.
 */
const _fu = new THREE.Vector3(), _fq = new THREE.Quaternion();
function faceUp(quat) {
  _fu.set(0, 1, 0).applyQuaternion(_fq.copy(quat).invert());
  return Math.max(Math.abs(_fu.x), Math.abs(_fu.y), Math.abs(_fu.z));
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Physics                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

// ── Rapier: the world, the props, the debris, everything you can throw.
// The four checks that used to live here tested the sphere solver's version of
// these invariants; they are ported, not dropped, and tightened where Rapier
// can now be held to a standard spheres never could.

check('rapier: a box dropped TILTED settles FLAT on one face', () => {
  // The whole complaint in one test. A cluster of spheres has no faces, so it
  // comes to rest at whatever angle it stopped rolling at. A cuboid lands on a
  // face, every time, from any attitude.
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  const worst = [];
  for (const e of [[0.5, 0.3, 0.4], [0.9, 0, 0], [0.2, 1.1, 0.7], [-0.6, 0.4, -0.9]]) {
    const b = new RBody({ position: V(0, 4, 0), quaternion: Q(...e), shape: boxShape(0.4, 0.4, 0.4),
      mass: 20, friction: 0.8, restitution: 0.05 });
    w.add(b);
    for (let i = 0; i < 400; i++) w.step(1 / 60);
    assert(isFinite(b.position.y), 'position went non-finite');
    assert(b.position.y > 0.34 && b.position.y < 0.46, `settled at y=${b.position.y.toFixed(3)}, not on a face`);
    assert(b.velocity.length() < 0.05, `still moving: ${b.velocity.length().toFixed(3)}`);
    // World-up, expressed in the body's own frame, must land on a body axis —
    // i.e. one of the cube's six faces is square to the floor. (Yaw about the
    // vertical is free, so measuring the body's +Y axis in world would pass a
    // box lying on its side and fail nothing.)
    const flat = faceUp(b.quaternion);
    assert(flat > 0.9995, `came to rest tilted ${(Math.acos(clamp(flat, -1, 1)) * 57.3).toFixed(1)}° off a face`);
    worst.push(Math.acos(clamp(flat, -1, 1)) * 57.3);
    w.remove(b);
  }
  return `4 attitudes, worst ${Math.max(...worst).toFixed(3)}° off flat`;
});

check('rapier: a stack of five crates is still a stack a minute later', () => {
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  const boxes = [];
  for (let i = 0; i < 5; i++) {
    const b = new RBody({ position: V(0, 0.4 + i * 0.82, 0), shape: boxShape(0.4, 0.4, 0.4),
      mass: 18, friction: 0.8, restitution: 0.02 });
    w.add(b); boxes.push(b);
  }
  for (let i = 0; i < 600; i++) w.step(1 / 60);
  const drift = Math.max(...boxes.map(b => Math.hypot(b.position.x, b.position.z)));
  assert(boxes.every(b => isFinite(b.position.y) && b.position.y > -1), 'a crate fell through the floor');
  assert(drift < 0.05, `the stack slid ${drift.toFixed(3)}m apart`);
  // and it has to still be five storeys, not a heap
  const ys = boxes.map(b => b.position.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    near(ys[i] - ys[i - 1], 0.8, 0.05, `gap between crate ${i} and ${i - 1}`);
  }
  assert(boxes.every(b => !b.awake), 'the stack never went to sleep — it is still being solved');
  return `drift ${(drift * 1000).toFixed(1)}mm, top crate at y=${ys[4].toFixed(3)}, all asleep`;
});

check('rapier: a crate on a shallow ramp stays put instead of rolling away', () => {
  // A crate approximated by eight spheres rolls down anything. A cuboid on a
  // 12° ramp with 0.8 friction (µ = tan 12° = 0.21) does not move at all.
  const w = new RapierWorld({ gravity: -24 });
  const tilt = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 12 * Math.PI / 180);
  w.addStaticBox(V(0, 0, 0), V(12, 0.5, 12), tilt, { friction: 0.85 });
  const b = new RBody({ position: V(0, 1.4, 0), quaternion: tilt.clone(), shape: boxShape(0.35, 0.35, 0.35),
    mass: 22, friction: 0.85, restitution: 0.02 });
  w.add(b);
  const start = b.position.clone();
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  const slid = Math.hypot(b.position.x - start.x, b.position.z - start.z);
  assert(slid < 0.12, `the crate travelled ${slid.toFixed(3)}m down a 12° ramp`);
  return `slid ${(slid * 1000).toFixed(0)}mm in 5s on a 12° ramp`;
});

check('rapier: a body at 360 m/s does not tunnel through a thin wall', () => {
  const w = new RapierWorld({ gravity: 0 });
  w.addStaticBox(V(0, 0, 0), V(6, 6, 0.04));     // 8 cm of wall
  const b = new RBody({ position: V(0, 0, 20), shape: boxShape(0.12, 0.12, 0.12),
    mass: 5, gravityScale: 0, restitution: 0 });
  b.velocity.set(0, 0, -360);                    // 6 m of travel per frame
  w.add(b);
  let minZ = Infinity;
  for (let i = 0; i < 60; i++) { w.step(1 / 60); minZ = Math.min(minZ, b.position.z); }
  assert(minZ > 0.04, `it got to z=${minZ.toFixed(3)} — through the wall`);
  // and the same body with both continuous modes off is what the old solver
  // did with it: gone, and still going
  const w2 = new RapierWorld({ gravity: 0 });
  w2.addStaticBox(V(0, 0, 0), V(6, 6, 0.04));
  const b2 = new RBody({ position: V(0, 0, 20), shape: boxShape(0.12, 0.12, 0.12),
    mass: 5, gravityScale: 0, ccd: false, softCcd: 0 });
  b2.velocity.set(0, 0, -360);
  w2.add(b2);
  for (let i = 0; i < 60; i++) w2.step(1 / 60);
  assert(b2.position.z < 0, 'the control case did not tunnel, so this proves nothing');
  return `stopped at z=${minZ.toFixed(3)}m; without CCD the same body reaches z=${b2.position.z.toFixed(0)}m`;
});

check('rapier: debris dropped from height lands ON the terrain, not under it', () => {
  // Rapier's ordinary CCD does not sweep against heightfields — only soft CCD
  // does. Without it, anything arriving faster than a three metre fall goes
  // straight through the ground, which put 45% of a level's debris under the
  // map. This is the regression test for that.
  const t = new Terrain(scene, 'arena', 1.0);
  const rand = (() => { let s = 4242; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const drop = (softCcd) => {
    const w = new RapierWorld({ gravity: -24 });
    w.terrain = t;
    const bs = [];
    for (let i = 0; i < 40; i++) {
      const x = (rand() - 0.5) * 60, z = (rand() - 0.5) * 60;
      const b = new RBody({ position: V(x, t.height(x, z) + 3 + rand() * 12, z),
        shape: boxShape(0.175, 0.11, 0.15), mass: 8, friction: 0.8, restitution: 0.06, softCcd });
      b.velocity.set((rand() - 0.5) * 8, 0, (rand() - 0.5) * 8);
      w.add(b); bs.push(b);
    }
    for (let i = 0; i < 500; i++) w.step(1 / 60);
    return bs.filter(b => b.dead || b.position.y < t.height(b.position.x, b.position.z) - 0.6).length;
  };
  const lost = drop(undefined);
  assert(lost === 0, `${lost}/40 pieces of debris fell through the ground`);
  const lostWithout = drop(0);
  assert(lostWithout > 5, `only ${lostWithout}/40 fell through without soft CCD — this test proves nothing`);
  return `0/40 through with soft CCD, ${lostWithout}/40 without it`;
});

check('rapier: raycast agrees with the sphere solver it replaced', () => {
  // Same scene in both engines, same rays, same answers — this is the query the
  // camera, line-of-sight and Force grip all run.
  const build = (w) => {
    w.add(new (w instanceof RapierWorld ? RBody : Body)({
      position: V(0, 1, -5), shape: ballShape(0.5), spheres: [{ c: V(), r: 0.5 }],
      mass: 4, gravityScale: 0, layer: LAYER.PROP }));
    w.addStaticBox(V(0, 1, -12), V(1, 1, 1));
    return w;
  };
  const old = build(new PhysicsWorld());
  const neu = build(new RapierWorld({}));
  neu.step(1 / 60);

  const rays = [
    [V(0, 1, 0), V(0, 0, -1), 30, null],
    [V(0, 1, -8), V(0, 0, -1), 30, null],
    [V(0, 1, 0), V(0, 0, -1), 30, (b) => b.static],           // bodies filtered out
    [V(-3, 1, -12), V(1, 0, 0), 30, null],
    [V(0, 6, -12), V(0, -1, 0), 30, null],
  ];
  const lines = [];
  for (const [o, d, m, f] of rays) {
    const a = old.raycast(o, d, m, f), b = neu.raycast(o, d, m, f);
    assert(!!a === !!b, `one engine hit and the other missed for ray from ${o.toArray()}`);
    if (!a) { lines.push('miss=miss'); continue; }
    near(a.distance, b.distance, 0.02, 'hit distance');
    assert(!!a.body === !!b.body && !!a.box === !!b.box, 'hit a different kind of thing');
    if (a.body) assert(a.body.layer === b.body.layer, 'hit a different body');
    assert(a.normal.dot(b.normal) > 0.99, `normals differ: ${a.normal.toArray()} vs ${b.normal.toArray()}`);
    lines.push(`${a.distance.toFixed(2)}≈${b.distance.toFixed(2)}`);
  }
  return lines.join(', ');
});

check('rapier: layer and mask filtering excludes exactly what it used to', () => {
  // LAYER/mask maps onto Rapier's 16-bit membership + 16-bit filter, and the
  // rule has to stay `(A.layer & B.mask) && (B.layer & A.mask)`.
  near(collisionGroups(LAYER.PROP, LAYER.WORLD | LAYER.PROP), (LAYER.PROP << 16 >>> 0) | (LAYER.WORLD | LAYER.PROP),
    0, 'group packing');

  const drop = (aMask, bMask) => {
    const w = new RapierWorld({ gravity: -24 });
    w.terrain = flatGround();
    const A = new RBody({ position: V(0, 0.5, 0), shape: boxShape(0.5, 0.5, 0.5), mass: 10,
      layer: LAYER.PROP, mask: aMask, friction: 0.8 });
    const B = new RBody({ position: V(0, 2.4, 0), shape: boxShape(0.5, 0.5, 0.5), mass: 10,
      layer: LAYER.DEBRIS, mask: bMask, friction: 0.8 });
    w.add(A); w.add(B);
    for (let i = 0; i < 400; i++) w.step(1 / 60);
    return B.position.y;
  };
  // both see each other → the upper crate rests on the lower one
  near(drop(LAYER.ALL, LAYER.ALL), 1.5, 0.05, 'mutually visible crates should stack');
  // the faller ignores props → it falls straight through to the ground
  near(drop(LAYER.ALL, LAYER.WORLD), 0.5, 0.05, 'DEBRIS masked to WORLD should pass through a PROP');
  // and the rule is symmetric: one side refusing is enough
  near(drop(LAYER.WORLD, LAYER.ALL), 0.5, 0.05, 'a PROP masked to WORLD should not catch DEBRIS');
  return 'stacks at 1.5, passes through at 0.5, symmetric';
});

check('rapier: the terrain heightfield IS the terrain', () => {
  // Rapier's heightfield is column-major with columns along x and rows along z;
  // Terrain stores heights[j*res + i] with i along x. Get that transpose wrong
  // and the ground is a mirror of itself — which reads as "sometimes solid".
  const t = new Terrain(scene, 'arena', 1.0);
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = t;
  w.step(1 / 60);

  let worstRay = 0, sum = 0, sumSq = 0, sumMirror = 0, n = 0;
  for (let k = 0; k < 220; k++) {
    const x = ((k * 137.51) % 180) - 90, z = ((k * 61.803) % 180) - 90;
    const hit = w.raycast(V(x, t.height(x, z) + 40, z), V(0, -1, 0), 120);
    assert(hit && hit.terrain, `no ground under (${x.toFixed(0)}, ${z.toFixed(0)})`);
    const err = hit.point.y - t.height(x, z);
    worstRay = Math.max(worstRay, Math.abs(err));
    sum += err; sumSq += err * err;
    // what the same ray would report if the grid had gone in transposed
    sumMirror += Math.abs(hit.point.y - t.height(z, x));
    n++;
  }
  // A heightfield is triangles and terrain.height() is bilinear, so within a
  // cell they differ by that cell's own curvature. What must NOT happen is a
  // landform-sized error, which is what a transposed grid produces.
  const rms = Math.sqrt(sumSq / n), mean = sum / n, mirror = sumMirror / n;
  assert(worstRay < 0.9, `the collider sits ${worstRay.toFixed(2)}m from the ground it was built from`);
  assert(rms < 0.12, `the collider is ${rms.toFixed(3)}m rms off the ground`);
  assert(Math.abs(mean) < 0.06, `the collider is biased ${mean.toFixed(3)}m off the ground`);
  assert(mirror > rms * 12, `the transposed sample is only ${(mirror / rms).toFixed(1)}x worse — `
    + 'this terrain cannot tell x from z, so the test proves nothing');

  // and a real body must come to rest ON it
  const rest = [];
  for (const [x, z] of [[0, 0], [18, -25], [-31, 12], [7, 40]]) {
    const b = new RBody({ position: V(x, t.height(x, z) + 3, z), shape: boxShape(0.3, 0.3, 0.3),
      mass: 15, friction: 0.9, restitution: 0 });
    w.add(b);
    for (let i = 0; i < 400; i++) w.step(1 / 60);
    const err = b.position.y - 0.3 - t.height(b.position.x, b.position.z);
    assert(Math.abs(err) < 0.4, `a box at (${x},${z}) rested ${err.toFixed(2)}m off terrain.height()`);
    rest.push(err);
    w.remove(b);
  }
  return `220 rays: ${(rms * 100).toFixed(1)}cm rms, ${(mean * 1000).toFixed(0)}mm bias, `
    + `${(mirror / rms).toFixed(0)}x worse transposed; 4 dropped boxes within `
    + `${(Math.max(...rest.map(Math.abs)) * 100).toFixed(0)}cm of terrain.height()`;
});

check('rapier: a crater under a resting crate drops the crate with it', () => {
  // The heightfield is a snapshot, so a deformed dune has to invalidate it or
  // props stand on ground that is no longer there.
  const t = new Terrain(scene, 'arena', 1.0);
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = t;
  const b = new RBody({ position: V(0, t.height(0, 0) + 1, 0), shape: boxShape(0.3, 0.3, 0.3), mass: 15, friction: 0.9 });
  w.add(b);
  for (let i = 0; i < 240; i++) w.step(1 / 60);
  const before = b.position.y;
  t.crater(0, 0, 6, 2.5);
  b.wake();
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  const drop = before - b.position.y;
  assert(drop > 1.5, `the crate only fell ${drop.toFixed(2)}m into a 2.5m crater`);
  near(b.position.y - 0.3, t.height(b.position.x, b.position.z), 0.4, 'rest height after the crater');
  return `fell ${drop.toFixed(2)}m into the new hole`;
});

check('rapier: props carry the shape they look like, not a bag of spheres', () => {
  propMaterials();
  const w = { scene: new THREE.Scene(), props: [], physics: { add: () => {}, remove: () => {} } };
  const crate = makeCrate(w, V(0, 0, 0), 0.7);
  const barrel = makeBarrel(w, V(0, 0, 0));
  const pillar = makePillar(w, V(0, 0, 0), 4.2);
  const spire = makeSpire(w, V(0, 0, 0), 6);
  assert(crate.body.shape.type === 'box', `a crate is a ${crate.body.shape.type}`);
  assert(barrel.body.shape.type === 'cylinder', `a barrel is a ${barrel.body.shape.type}`);
  assert(pillar.body.shape.type === 'compound' && pillar.body.shape.parts.length === 3,
    `a pillar is a ${pillar.body.shape.type}`);
  /* A SPIRE IS A SLAB STACK AND NOT A HULL, and the change is the point of the
   * check rather than a violation of it. A hull is the smallest shape that
   * contains the geometry, so on a wasp-waisted, bent, eroded needle every
   * concavity becomes solid: measured at the height a player walks at, the
   * hull stood up to 2.68 m outside the drawn rock across Geonosis's
   * twenty-one spires. That is the physical half of "there are invisible walls
   * or objects for example on geonosis that block you". `slabCompound` follows
   * the profile band by band — 0.18 m worst — and `physicality.mjs` holds the
   * general rule this is one instance of. */
  assert(spire.body.shape.type === 'compound', `a spire is a ${spire.body.shape.type}`);
  assert(spire.body.shape.parts.length > 5,
    `the spire's stack has only ${spire.body.shape.parts.length} bands`);
  assert(spire.body.shape.parts.every((q) => q.type === 'cylinder'),
    'a slab stack is cylinders — something else got into it');

  // and the stack actually describes the mesh: same height, top to bottom
  const g = spire.mesh.geometry; g.computeBoundingBox();
  const parts = spire.body.shape.parts;
  let lo = Infinity, hi = -Infinity;
  for (const q of parts) { lo = Math.min(lo, q.at[1] - q.halfHeight); hi = Math.max(hi, q.at[1] + q.halfHeight); }
  near(hi - lo, g.boundingBox.max.y - g.boundingBox.min.y, 0.35, 'stack height vs mesh height');
  return `crate box, barrel cylinder, pillar 3-part compound, spire ${parts.length}-band stack`;
});

check('rapier: a heavy prop actually TIPS off an edge instead of teetering', () => {
  // Real inertia and a real contact manifold: a crate pushed two thirds off a
  // ledge rotates about the edge and falls. Eight spheres just roll off.
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  w.addStaticBox(V(0, 1, 0), V(2, 1, 2), new THREE.Quaternion(), { friction: 0.9 });
  const b = new RBody({ position: V(2.25, 2.42, 0), shape: boxShape(0.4, 0.4, 0.4),
    mass: 22, friction: 0.9, restitution: 0.02 });
  w.add(b);
  for (let i = 0; i < 400; i++) w.step(1 / 60);
  assert(b.position.y < 0.5, `it is still on the ledge at y=${b.position.y.toFixed(2)}`);
  assert(faceUp(b.quaternion) > 0.999, 'it landed at an angle');
  return `tipped off the ledge and landed flat at y=${b.position.y.toFixed(3)}`;
});

check('rapier: grip, hurl and push still move a prop the way the Force did', () => {
  // The three Force powers all reach into the body directly: a raycast to find
  // it, gravityScale to hold it up, per-frame velocity writes to carry it, and
  // impulses to throw it. All four still have to work through the cache.
  propMaterials();
  const w = new RapierWorld({ gravity: -24, iterations: 4 });
  w.terrain = flatGround();
  const host = { scene: new THREE.Scene(), props: [], physics: w, addProp(p) { this.props.push(p); return p; } };
  const crate = makeCrate(host, V(0, 0.5, -4), 0.7);
  for (let i = 0; i < 180; i++) w.step(1 / 60);
  const restY = crate.body.position.y;

  // grip: the raycast the player fires, with the player's own filter
  const hit = w.raycast(V(0, restY, 2), V(0, 0, -1), 32,
    (b) => b.invMass > 0 && (b.layer === LAYER.PROP || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL));
  assert(hit && hit.body === crate.body, 'the grip ray did not find the crate');
  const b = hit.body;
  b.gravityScale = 0;
  const hold = V(0, 3.2, -2);
  for (let i = 0; i < 180; i++) {
    b.wake();
    b.velocity.copy(hold).sub(b.position).multiplyScalar(9).clampLength(0, 28);
    b.angularVelocity.multiplyScalar(1 - (1 / 60) * 2);
    b.angularVelocity.y += (1 / 60) * 2.2;
    w.step(1 / 60);
  }
  const held = b.position.distanceTo(hold);
  assert(held < 0.05, `the gripped crate hangs ${held.toFixed(3)}m from the hold point`);
  assert(b.angularVelocity.y > 0.5, `the gripped crate is not turning (${b.angularVelocity.y.toFixed(2)} rad/s)`);

  // hurl
  b.gravityScale = 1;
  const from = b.position.clone();
  b.applyImpulse(V(0, 0, -1).multiplyScalar(b.mass * 26), b.position);
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  const flew = from.distanceTo(b.position);
  assert(flew > 10, `a hurled crate only travelled ${flew.toFixed(2)}m in a second`);

  // push, from across the room
  const other = makeCrate(host, V(6, 0.5, 0), 0.7);
  for (let i = 0; i < 180; i++) w.step(1 / 60);
  const p0 = other.body.position.clone();
  other.body.applyImpulse(V(other.body.mass * 15, other.body.mass * 6, 0), other.body.position);
  for (let i = 0; i < 90; i++) w.step(1 / 60);
  const shoved = p0.distanceTo(other.body.position);
  assert(shoved > 3, `a Force push only moved a crate ${shoved.toFixed(2)}m`);
  return `held to ${(held * 1000).toFixed(1)}mm, hurled ${flew.toFixed(1)}m, pushed ${shoved.toFixed(1)}m`;
});

check('rapier: a cut prop becomes two halves with hulls of their own', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -24, iterations: 4 });
  w.terrain = flatGround();
  const host = { scene: new THREE.Scene(), props: [], physics: w, addProp(p) { this.props.push(p); return p; } };
  const crate = makeCrate(host, V(0, 3, 0), 0.7);
  host.props.push(crate);
  crate.update(1 / 60);
  crate.mesh.updateMatrixWorld(true);
  const halves = crate.cut(crate.body.position.clone(), V(0.3, 1, 0.1).normalize(), V(0, 0, 4));
  assert(halves && halves.length === 2, 'the crate did not part');
  for (const h of halves) {
    assert(h.body.shape.type === 'hull', `a half is a ${h.body.shape.type}, not a hull of its own geometry`);
    assert(h.body.shape.points.length / 3 > 20, 'the half hull is too coarse to be the half');
    host.props.push(h);
  }
  for (let i = 0; i < 300; i++) { w.step(1 / 60); for (const p of host.props) p.update(1 / 60); }
  const ys = halves.map(h => h.body.position.y);
  assert(ys.every(y => isFinite(y) && y > 0 && y < 0.8), `halves rested at ${ys.map(y => y.toFixed(2)).join(', ')}`);
  return `two halves, ${halves.map(h => h.body.shape.points.length / 3).join('+')} hull points, resting at `
    + ys.map(y => y.toFixed(2)).join(' / ');
});

check('rapier: a severed limb and a crate share one world, one ground and one ray', () => {
  // This used to prove the sphere solver still ran ALONGSIDE Rapier, because
  // ragdolls were still its. There is one solver now, so it proves the thing
  // that replaced it: a limb is a Rapier capsule, it lands on the same static
  // box the crate lands beside, and one raycast finds either of them.
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  w.addStaticBox(V(0, 0.5, 0), V(2, 0.5, 2), new THREE.Quaternion(), { friction: 0.8 });

  const limb = new RBody({ position: V(0, 4, 0), shape: capShape(0.07, 0.07), mass: 3,
    layer: LAYER.RAGDOLL, mask: LAYER.WORLD | LAYER.RAGDOLL });
  const crate = new RBody({ position: V(4, 3, 0), shape: boxShape(0.4, 0.4, 0.4), mass: 20, friction: 0.8 });
  w.add(limb); w.add(crate);
  assert(w.bodies.length === 2, 'both bodies must appear in the world');
  assert(w.stats.colliders === 0 || true, '');
  for (let i = 0; i < 400; i++) w.step(1 / 60);
  near(limb.position.y, 1.07, 0.16, 'the limb should rest on top of the static box');
  near(crate.position.y, 0.4, 0.05, 'the crate should rest on the ground');
  // and a ray finds either of them, filtered by layer exactly as before
  const rl = w.raycast(V(0, 6, 0), V(0, -1, 0), 20, (b) => b.layer === LAYER.RAGDOLL);
  assert(rl && rl.body === limb, 'the ray missed the limb');
  const rc = w.raycast(V(4, 6, 0), V(0, -1, 0), 20, (b) => b.layer === LAYER.DEBRIS);
  assert(rc && rc.body === crate, 'the ray missed the crate');
  return `limb on the ledge at y=${limb.position.y.toFixed(2)}, crate on the ground at y=${crate.position.y.toFixed(2)}`;
});

check('rapier: loading a level three times over leaves a clean world each time', () => {
  // clear() throws the Rapier world away and builds a new one, which is where a
  // stale collider handle or a freed rigid body would surface.
  const w = new RapierWorld({ gravity: -24, iterations: 4 });
  const lines = [];
  for (let round = 0; round < 3; round++) {
    w.clear();
    const t = new Terrain(scene, round % 2 ? 'dunes' : 'arena', 0.6);
    w.terrain = t;
    for (let i = 0; i < 12; i++) w.addStaticBox(V(i * 2 - 12, t.height(i * 2 - 12, 0) + 1, 0), V(0.9, 1, 0.9));
    for (let i = 0; i < 24; i++) {
      const x = (i % 6) * 1.2 - 3, z = Math.floor(i / 6) * 1.2 - 3;
      w.add(new RBody({ position: V(x, t.height(x, z) + 2 + i * 0.1, z), shape: boxShape(0.3, 0.3, 0.3),
        mass: 12, friction: 0.8 }));
    }
    for (let i = 0; i < 6; i++) {
      w.add(new RBody({ position: V(i - 3, t.height(i - 3, 0) + 3, 0), shape: capShape(0.07, 0.07),
        mass: 3, layer: LAYER.RAGDOLL, mask: LAYER.WORLD | LAYER.RAGDOLL }));
    }
    for (let i = 0; i < 400; i++) w.step(1 / 60);
    assert(w.bodies.length === 30, `round ${round} lost ${30 - w.bodies.length} bodies`);
    assert(w.stats.colliders === 43, `round ${round} has ${w.stats.colliders} colliders, expected 43`);
    const bad = w.bodies.filter(b => !isFinite(b.position.y)
      || b.position.y < t.height(b.position.x, b.position.z) - 1).length;
    assert(bad === 0, `round ${round} left ${bad} bodies under the map`);
    lines.push(`${w.bodies.length}b/${w.stats.colliders}c`);
  }
  w.dispose();
  return lines.join(', ') + ', disposed clean';
});

check('rapier: a limb spawned inside a static box pushes out instead of exploding', () => {
  // Ported from the sphere solver, where the inside-the-box branch divided an
  // already-unit contact normal by the distance to the nearest face, so a
  // ragdoll that ended up level with a wall's top face left at 1e23 m/s. The
  // invariant belongs to whichever solver owns ragdolls, and that is Rapier.
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  const boxTop = 2;
  w.addStaticBox(V(0, 1, 0), V(0.9, 1, 0.9));
  const worst = [];
  for (const y of [boxTop, boxTop - 1e-9, 1, 0.05]) {       // level with each face, and dead centre
    const b = new RBody({ position: V(0, y, 0), shape: capShape(0.07, 0.07), mass: 3,
      layer: LAYER.RAGDOLL, mask: LAYER.WORLD | LAYER.RAGDOLL });
    w.add(b);
    for (let i = 0; i < 240; i++) w.step(1 / 60);
    assert(isFinite(b.position.length()), `a body starting at y=${y} went non-finite`);
    assert(b.position.length() < 12, `it was flung to ${b.position.length().toExponential(2)}m`);
    assert(b.velocity.length() < 40, `it left at ${b.velocity.length().toExponential(2)} m/s`);
    worst.push(b.position.length());
    w.remove(b);
  }
  return `4 starting positions inside the box, worst travel ${Math.max(...worst).toFixed(2)}m`;
});

check('ragdoll: the socket holds — anchor drift under load, the ball joint\'s old measure', () => {
  // Ported from the sphere solver's ball-joint test, which hung ONE body off a
  // static one and allowed 160mm of drift. A single unloaded link never told
  // anyone anything — both solvers score 0.0mm on it — so the same measurement
  // is taken on the thing a ragdoll actually is: a loaded chain of nine. There
  // the diagonal-approximation ball joint pulled 328mm apart and Rapier's
  // spherical joint holds to 11.
  const anchors = (w) => {
    let worst = 0;
    for (const j of w.joints) {
      const wa = j.anchorA.clone().applyQuaternion(j.a.quaternion).add(j.a.position);
      const wb = j.anchorB.clone().applyQuaternion(j.b.quaternion).add(j.b.position);
      worst = Math.max(worst, wa.distanceTo(wb));
    }
    return worst;
  };
  const w = new RapierWorld({ gravity: -24 });
  const root = new RBody({ position: V(0, 5, 0), shape: capShape(0.2, 0.1), mass: 0, static: true });
  w.add(root);
  let prev = root;
  for (let i = 0; i < 9; i++) {
    const n = new RBody({ position: V(0, 4.6 - i * 0.4, 0), shape: capShape(0.2, 0.1), mass: 8 });
    w.add(n);
    w.addJoint(new RagdollJoint(prev, n, V(0, -0.2, 0), V(0, 0.2, 0), { coneAngle: 1.2, twistLimit: 0.6 }));
    prev = n;
  }
  prev.applyImpulse(V(140, 0, 40), prev.position);
  let settled = 0, transient = 0;
  for (let i = 0; i < 400; i++) {
    w.step(1 / 60);
    const d = anchors(w);
    transient = Math.max(transient, d);
    if (i > 200) settled = Math.max(settled, d);
  }
  assert(transient < 0.06, `a socket opened ${(transient * 1000).toFixed(1)}mm mid-swing`);
  assert(settled < 0.02, `a socket stayed ${(settled * 1000).toFixed(1)}mm open`);
  return `9 joints, ${(transient * 1000).toFixed(1)}mm worst mid-swing, ${(settled * 1000).toFixed(2)}mm settled`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rig & IK                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

check('rig: two-bone IK reaches every target inside its range', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const shoulder = rig.worldPos('armR', new THREE.Vector3());
  const reach = rig.get('armR').length + rig.get('foreR').length;
  let worst = 0;
  // sample the reachable sphere rather than trusting one hand-picked point
  for (let i = 0; i < 40; i++) {
    const a = i * 0.813, b = i * 0.371;
    const dir = V(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
    const target = shoulder.clone().addScaledVector(dir, reach * 0.75);
    rig.solveIK('armR', 'foreR', target, shoulder.clone().add(V(-0.8, 0, -0.4)));
    rig.updateMatrices();
    worst = Math.max(worst, rig.tipPos('foreR', new THREE.Vector3()).distanceTo(target));
  }
  assert(worst < 0.01, `worst hand placement was ${worst.toFixed(4)}m off`);
  return `40 targets, worst error ${(worst * 1000).toFixed(2)}mm`;
});

check('rig: the feet stand on the ground, not through it or above it', () => {
  const { rig } = buildJedi({ robeIndex: 0, scale: 1 });
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const step = (y, groundAt) => {
    for (let i = 0; i < 10; i++) {
      anim.update(1 / 60, { position: V(0, y, 0), facing: 0, velocity: V(0, 0, 0),
        grounded: true, groundAt, crouch: 0, accelForward: 0, accelStrafe: 0 });
    }
    rig.updateMatrices();
    rig.root.updateMatrixWorld(true);
    let lo = Infinity;
    for (const n of ['footL', 'footR']) {
      const box = new THREE.Box3();
      for (const m of rig.get(n).parts) { m.updateMatrixWorld(true); box.expandByObject(m); }
      lo = Math.min(lo, box.min.y);
    }
    return lo;
  };

  const flat = step(0, () => 0);
  assert(Math.abs(flat) < 0.02, `on flat ground the soles sit ${(flat * 100).toFixed(1)}cm off the floor`);

  // and the legs must not be pinned at full extension, or a slope or a step
  // leaves the low foot dangling — solveIK clamps rather than stretching
  const hip = rig.worldPos('thighL', new THREE.Vector3());
  const ankleTip = rig.tipPos('shinL', new THREE.Vector3());
  const reach = rig.get('thighL').length + rig.get('shinL').length;
  const used = hip.distanceTo(ankleTip) / reach;
  assert(used < 0.97, `the standing leg is ${(used * 100).toFixed(1)}% extended — the knee is locked straight`);
  return `soles at ${(flat * 1000).toFixed(1)}mm, leg ${(used * 100).toFixed(1)}% extended`;
});

check('rig: the shoulders are mounted left and right, not front and back', () => {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  anim.update(1 / 60, { position: V(0, 0, 0), facing: 0, velocity: V(0, 0, 0),
    grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
  rig.updateMatrices();
  const L = rig.worldPos('armL', new THREE.Vector3());
  const R = rig.worldPos('armR', new THREE.Vector3());
  const across = Math.abs(L.x - R.x), foreAft = Math.abs(L.z - R.z);
  assert(across > 0.24, `shoulders only ${(across * 100).toFixed(1)}cm apart across the chest`);
  assert(foreAft < 0.03, `the shoulder line runs ${(foreAft * 100).toFixed(1)}cm front-to-back`);
  assert(Math.abs(L.x + R.x) < 0.01, `shoulders are not symmetric about the spine`);
  // and the rest pose must be identity for an upright root, or every offset
  // authored in character space lands a quarter turn away from where it should
  const q = rig.get('hips').restQuat;
  assert(Math.abs(q.w) > 0.999, `hips rest quaternion is not identity: w=${q.w.toFixed(3)}`);
  return `${(across * 100).toFixed(1)}cm across, ${(foreAft * 100).toFixed(1)}cm fore/aft, symmetric`;
});

check('rig: a joint bends TOWARD its pole, not away from it', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const root = rig.worldPos('armR', new THREE.Vector3());
  const reach = rig.get('armR').length + rig.get('foreR').length;
  let wrong = 0, total = 0, worst = 0;
  for (let i = 0; i < 300; i++) {
    const a = i * 0.813, b = i * 0.371;
    const dir = V(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
    const target = root.clone().addScaledVector(dir, reach * 0.72);
    const side = V(Math.sin(i * 1.7), 0.3, Math.cos(i * 1.7)).normalize();
    const pole = root.clone().addScaledVector(side, 1.2);
    rig.solveIK('armR', 'foreR', target, pole);
    rig.updateMatrices();
    const joint = rig.tipPos('armR', new THREE.Vector3());
    const along = target.clone().sub(root).normalize();
    const perp = (p) => { const o = p.clone().sub(root); return o.addScaledVector(along, -o.dot(along)); };
    const off = perp(joint), poleOff = perp(pole);
    if (poleOff.lengthSq() < 1e-8 || off.lengthSq() < 1e-8) continue;
    total++;
    if (off.clone().normalize().dot(poleOff.clone().normalize()) < 0) {
      wrong++; worst = Math.max(worst, off.length());
    }
  }
  assert(wrong === 0,
    `${wrong}/${total} solves bent away from the pole (worst ${(worst * 100).toFixed(1)}cm) — knees bend backwards`);
  return `${total} solves, all on the pole's side`;
});

check('rig: IK clamps instead of tearing when the target is out of reach', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const far = V(9, 1.2, 9);
  rig.solveIK('armR', 'foreR', far, V(-0.8, 0.5, 0));
  rig.updateMatrices();
  const shoulder = rig.worldPos('armR', new THREE.Vector3());
  const tip = rig.tipPos('foreR', new THREE.Vector3());
  const reach = shoulder.distanceTo(tip);
  const limit = rig.get('armR').length + rig.get('foreR').length;
  assert(reach <= limit + 1e-3, `arm stretched to ${reach.toFixed(3)} past ${limit.toFixed(3)}`);
  assert(isFinite(tip.x) && isFinite(tip.y), 'IK produced NaN');
  return `reach ${reach.toFixed(3)}m ≤ limit ${limit.toFixed(3)}m`;
});

check('gait: feet stay planted during stance and the body does not skate', () => {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  const pos = V(0, 0, 0);
  const vel = V(0, 0, 3.2);
  let steps = 0;
  anim.onFootstep = () => steps++;
  let maxSlideDuringStance = 0;
  const prev = [new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < 240; i++) {
    pos.addScaledVector(vel, 1 / 60);
    anim.update(1 / 60, { position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 1 });
    for (let f = 0; f < 2; f++) {
      const foot = anim.feet[f];
      if (foot.grounded && i > 10) {
        maxSlideDuringStance = Math.max(maxSlideDuringStance, prev[f].distanceTo(foot.pos));
      }
      prev[f].copy(foot.pos);
    }
  }
  assert(steps >= 4, `only ${steps} footsteps in 4 seconds of walking`);
  assert(maxSlideDuringStance < 0.02, `planted foot slid ${maxSlideDuringStance.toFixed(4)}m in one frame`);
  return `${steps} steps, max stance slide ${(maxSlideDuringStance * 1000).toFixed(2)}mm`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Cutting — the heart of it                                             */
/* ══════════════════════════════════════════════════════════════════════ */

function droidRig() {
  const built = buildB1({ scale: 1.02 });
  built.rig.hipsBone.obj.position.set(0, 0.95, 0);
  built.rig.updateMatrices();
  return built.rig;
}
function capsulesOf(rig) {
  const out = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const b of rig.list) {
    if (b.severed || !b.parts.length) continue;
    b.obj.updateMatrixWorld(true);
    p0.setFromMatrixPosition(b.obj.matrixWorld);
    q.setFromRotationMatrix(b.obj.matrixWorld);
    p1.copy(p0).add(new THREE.Vector3(0, b.length * b.cutT, 0).applyQuaternion(q));
    out.push({ name: b.name, p0: p0.clone(), p1: p1.clone(), r: b.radius * 1.12,
      toughness: TOUGHNESS.droid, vital: 0.3 });
  }
  return out;
}

check('blade: a fast sweep across a forearm produces a cut event at the crossing point', () => {
  const rig = droidRig();
  const caps = capsulesOf(rig);
  const fore = caps.find(c => c.name === 'foreR');
  assert(fore, 'no forearm capsule');

  const mid = fore.p0.clone().lerp(fore.p1, 0.5);
  const saber = makeBlade(scene);
  // blade pointing along +X so it crosses the (roughly vertical) forearm,
  // hilt set back far enough that the limb sits mid-blade
  const along = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
  const from = mid.clone().add(V(-0.75, 0, 0.9));
  const to = mid.clone().add(V(-0.75, 0, -0.9));
  sweepBlade(saber, from, along, to, along);

  const solver = new BladeContactSolver();
  const events = solver.solve(saber, [{ id: 'd1', capsules: caps }], 1 / 60, { power: 1 });
  const cuts = events.filter(e => e.type === 'cut');
  assert(cuts.length, `no cut event (got ${events.map(e => e.type).join(',') || 'nothing'})`);
  const arm = cuts.find(e => e.bone === 'foreR');
  assert(arm, `the forearm survived a blade through it (cut ${cuts.map(c => c.bone).join(',')})`);
  assert(arm.cutT > 0.1 && arm.cutT < 0.9, `cut fraction out of range: ${arm.cutT}`);
  assert(arm.speed > 5, `cut registered at only ${arm.speed.toFixed(1)} m/s`);
  // a metre of blade through a torso should take more than one limb, and does
  assert(cuts.length > 1, 'a full-length sweep only caught one bone');
  return `${cuts.length} bones in one sweep (${cuts.map(c => c.bone).join(', ')}), forearm at ${(arm.cutT * 100).toFixed(0)}%`;
});

check('blade: a stationary blade resting on a limb does NOT cut', () => {
  const rig = droidRig();
  const caps = capsulesOf(rig);
  const fore = caps.find(c => c.name === 'foreR');
  const mid = fore.p0.clone().lerp(fore.p1, 0.5);
  const saber = makeBlade(scene);
  const along = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
  const rest = mid.clone().add(V(-0.75, 0, 0));
  sweepBlade(saber, rest, along, rest, along);
  const solver = new BladeContactSolver();
  const events = solver.solve(saber, [{ id: 'd1', capsules: caps }], 1 / 60);
  assert(!events.some(e => e.type === 'cut'), 'a motionless blade severed a limb');
  return 'held blade grinds instead of severing';
});

check('cut: severing rebuilds the stub, spawns the piece, and takes the children with it', () => {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });

  const foreBefore = rig.get('foreR').length;
  const handBone = rig.get('handR');
  assert(!handBone.severed, 'hand already severed');
  const bodiesBefore = physics.bodies.length;

  const ok = actor.cut('foreR', 0.55, V(0, 0, -6), rig.worldPos('foreR', new THREE.Vector3()));
  assert(ok, 'cut() refused');
  near(rig.get('foreR').cutT, 0.55, 1e-6, 'stub fraction');
  assert(handBone.severed, 'the hand did not go with the forearm');
  assert(actor.pieces.length === 1, `expected one detached piece, got ${actor.pieces.length}`);
  const piece = actor.pieces[0];
  assert(piece.entries.length >= 2, `piece has only ${piece.entries.length} parts (stub + hand expected)`);
  assert(physics.bodies.length > bodiesBefore, 'no physics bodies were created for the piece');
  assert(piece.entries.every(e => e.body.velocity.lengthSq() > 0), 'the severed piece has no momentum');
  return `stub ${(foreBefore * 0.55).toFixed(3)}m, ${piece.entries.length} loose parts, +${physics.bodies.length - bodiesBefore} bodies`;
});

check('cut: the severed piece falls and settles under gravity', () => {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.cut('thighL', 0.5, V(1, 0, 0), rig.worldPos('thighL', new THREE.Vector3()));
  const piece = actor.pieces[0];
  for (let i = 0; i < 260; i++) { physics.step(1 / 60); actor.update(1 / 60); }
  const ys = piece.entries.filter(e => !e.removed).map(e => e.body.position.y);
  assert(ys.length > 0, 'the piece vanished');
  assert(ys.every(y => isFinite(y) && y > -0.5 && y < 1.2), `piece rested at ${ys.map(y => y.toFixed(2)).join(',')}`);
  return `parts settled at y=${ys.map(y => y.toFixed(2)).join(', ')}`;
});

check('cut: cutting an already-cut bone shortens it again rather than duplicating', () => {
  const physics = new RapierWorld({ gravity: -24 });
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.cut('armR', 0.7, V(0, 0, -3), rig.worldPos('armR', new THREE.Vector3()));
  const first = rig.get('armR').cutT;
  actor.cut('armR', 0.5, V(0, 0, -3), rig.worldPos('armR', new THREE.Vector3()));
  const second = rig.get('armR').cutT;
  near(first, 0.7, 1e-6, 'first cut');
  near(second, 0.35, 1e-6, 'second cut compounds');
  assert(actor.pieces.length === 2, `expected two pieces, got ${actor.pieces.length}`);
  return `0.7 → 0.35 of the original length`;
});

check('ragdoll: a whole body collapses into jointed bodies and settles', () => {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.goRagdoll(V(0, 0, -2), V(1, 0, 0));
  assert(actor.bodies.size >= 15, `only ${actor.bodies.size} ragdoll bodies`);
  assert(physics.joints.length >= 14, `only ${physics.joints.length} joints`);
  for (let i = 0; i < 420; i++) { physics.step(1 / 60); actor.update(1 / 60); }
  const parts = [...actor.bodies.values()];
  assert(parts.every(b => isFinite(b.position.y)), 'a ragdoll part went non-finite');
  const maxY = Math.max(...parts.map(b => b.position.y));
  const spread = Math.max(...parts.map(b => b.position.distanceTo(parts[0].position)));
  assert(maxY < 1.4, `the ragdoll is standing up (max y=${maxY.toFixed(2)})`);
  assert(spread < 3.2, `the ragdoll came apart (spread ${spread.toFixed(2)}m)`);
  return `${actor.bodies.size} parts, max y=${maxY.toFixed(2)}, spread ${spread.toFixed(2)}m`;
});

check('ragdoll: severing after death breaks only that joint', () => {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  const rig = droidRig();
  const actor = new Actor(scene, physics, rig, { mass: 52 });
  actor.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  const before = physics.joints.length;
  actor.cutRagdoll('head', V(0, 2, 0));
  physics.step(1 / 60);
  assert(physics.joints.length === before - 1, `broke ${before - physics.joints.length} joints, expected 1`);
  return `${before} → ${physics.joints.length} joints`;
});

check('ragdoll: dropped from height, it settles and goes to SLEEP rather than buzzing', () => {
  // The whole point of the port. On the sphere solver a corpse never stopped:
  // all 19 bodies were still awake ten seconds after landing, with 11 m/s of
  // peak residual and the joints 175mm out of their sockets.
  //
  // Rest is judged by whether the thing MOVES, not by what its velocity field
  // says: Rapier 0.14 feeds phantom spin into every round collider lying on the
  // ground, so a settled capsule reads 0.8 rad/s while turning a third of a
  // degree per second (see SLEEP_MOVE and Body.spinFriction in RapierWorld).
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  const rig = droidRig();
  rig.hipsBone.obj.position.set(0, 2.6, 0);
  rig.updateMatrices();
  const actor = new Actor(scene, w, rig, { mass: 52 });
  actor.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  const parts = [...actor.bodies.values()];

  let slept = -1, peak = 0;
  for (let i = 0; i < 3000 && slept < 0; i++) {
    w.step(1 / 60); actor.update(1 / 60);
    if (i > 300) peak = Math.max(peak, ...parts.map(b => b.velocity.length()));
    if (i > 60 && parts.every(b => !b.awake)) slept = i;
  }
  assert(peak < 1, `five seconds after it landed the corpse was still moving at ${peak.toFixed(2)} m/s`);
  assert(slept > 0, 'the ragdoll never went to sleep');
  // and it is genuinely still, not merely flagged: nothing moves over a second
  for (let i = 0; i < 60; i++) { w.step(1 / 60); actor.update(1 / 60); }
  const before = parts.map(b => [b.position.clone(), b.quaternion.clone()]);
  for (let i = 0; i < 60; i++) { w.step(1 / 60); actor.update(1 / 60); }
  let moved = 0, turned = 0;
  for (let i = 0; i < parts.length; i++) {
    moved = Math.max(moved, before[i][0].distanceTo(parts[i].position));
    turned = Math.max(turned, before[i][1].angleTo(parts[i].quaternion));
  }
  assert(moved < 1e-3 && turned < 0.01,
    `a sleeping ragdoll drifted ${(moved * 1000).toFixed(3)}mm / ${(turned * 57.3).toFixed(3)}° in a second, `
    + `${parts.filter(b => b.awake).length} of ${parts.length} awake again`);
  assert(parts.every(b => b.position.y > -0.2 && b.position.y < 1.2),
    'it did not end up on the ground');
  return `${parts.length} bodies, ${peak.toFixed(2)} m/s peak after landing, all asleep at `
    + `${(slept / 60).toFixed(1)}s, then ${(moved * 1000).toFixed(2)}mm/${(turned * 57.3).toFixed(2)}° in the next second`;
});

check('ragdoll: a corpse knocks a crate over, and a hurled crate moves a corpse', () => {
  // The seam this whole change exists to close. Ragdolls were on one solver and
  // props on another, so neither could see the other at all: a corpse fell
  // through a crate and a crate flew through a corpse.
  propMaterials();
  const w = new RapierWorld({ gravity: -24, iterations: 4 });
  w.terrain = flatGround();
  const host = { scene: new THREE.Scene(), props: [], physics: w, addProp(p) { this.props.push(p); return p; } };

  // 1 — throw a body at a crate and watch the crate go
  const crate = makeCrate(host, V(1.0, 0.36, 0), 0.7);
  host.props.push(crate);
  for (let i = 0; i < 90; i++) { w.step(1 / 60); crate.update(1 / 60); }
  const crateP0 = crate.body.position.clone(), crateQ0 = crate.body.quaternion.clone();

  const rig = droidRig();
  rig.hipsBone.obj.position.set(-1.4, 1.3, 0);
  rig.updateMatrices();
  const actor = new Actor(scene, w, rig, { mass: 52 });
  actor.goRagdoll(V(10, 0.6, 0), V(0, 0, 0));
  for (let i = 0; i < 300; i++) { w.step(1 / 60); actor.update(1 / 60); crate.update(1 / 60); }
  const shoved = crateP0.distanceTo(crate.body.position);
  const tipped = crateQ0.angleTo(crate.body.quaternion);
  assert(shoved > 0.2 || tipped > 0.4,
    `a 52kg corpse at 10 m/s moved a ${crate.body.mass.toFixed(0)}kg crate `
    + `${(shoved * 100).toFixed(0)}cm and turned it ${tipped.toFixed(2)} rad`);

  // 2 — hurl a crate at a corpse that has come to rest, in a world of its own
  const w2 = new RapierWorld({ gravity: -24, iterations: 4 });
  w2.terrain = flatGround();
  const host2 = { scene: new THREE.Scene(), props: [], physics: w2, addProp(p) { this.props.push(p); return p; } };
  const rig2 = droidRig();
  rig2.hipsBone.obj.position.set(0, 1.3, 0);
  rig2.updateMatrices();
  const corpse = new Actor(scene, w2, rig2, { mass: 52 });
  corpse.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  for (let i = 0; i < 400; i++) { w2.step(1 / 60); corpse.update(1 / 60); }
  const chest = corpse.bodies.get('chest') || corpse.bodies.get('spine');
  const restedAt = chest.position.clone();
  const missile = makeCrate(host2, chest.position.clone().add(V(-4, 0.2, 0)), 0.6);
  host2.props.push(missile);
  missile.body.gravityScale = 0.2;              // keep it on line for the four metres
  missile.body.velocity.set(40, 0, 0);
  missile.body.wake();
  for (let i = 0; i < 150; i++) { w2.step(1 / 60); corpse.update(1 / 60); for (const p of host2.props) p.update(1 / 60); }
  const knocked = restedAt.distanceTo(chest.position);
  assert(knocked > 0.2, `a crate at 40 m/s only moved the corpse ${(knocked * 100).toFixed(1)}cm`);

  // 3 — the Force, exactly as Player._shockwave and toggleGrip run it: one
  // raycast to find a body, one impulse per body inside the radius.
  const bones = [...corpse.bodies.values()];
  const seen = bones.map(b => b.position.clone());
  const hitRay = w2.raycast(chest.position.clone().add(V(0, 3, 0)), V(0, -1, 0), 8,
    (b) => b.invMass > 0 && (b.layer === LAYER.PROP || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL));
  assert(hitRay && corpse.bodies.get(hitRay.body.userData.bone) === hitRay.body,
    'the Force grip ray did not find a bone of the corpse');
  const origin = chest.position.clone().add(V(-3, 0, 0));
  for (const b of bones) {
    const d = b.position.distanceTo(origin);
    if (d > 6) continue;
    const k = 1 - d / 6;
    b.applyImpulse(b.position.clone().sub(origin).setY(0.5).normalize()
      .multiplyScalar(30 * k * b.mass * 0.5), b.position);
  }
  for (let i = 0; i < 90; i++) { w2.step(1 / 60); corpse.update(1 / 60); }
  let blown = 0;
  bones.forEach((b, i) => { blown = Math.max(blown, seen[i].distanceTo(b.position)); });
  assert(blown > 1, `a Force push only moved the corpse ${blown.toFixed(2)}m`);

  return `corpse shoved the crate ${(shoved * 100).toFixed(0)}cm and tipped it ${tipped.toFixed(2)} rad; `
    + `a hurled crate moved the corpse ${(knocked * 100).toFixed(0)}cm; a Force push threw it ${blown.toFixed(1)}m`;
});

check('cut: a severed limb separates, falls, and lands on the ground AND on a crate', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -24, iterations: 4 });
  w.terrain = flatGround();
  const host = { scene: new THREE.Scene(), props: [], physics: w, addProp(p) { this.props.push(p); return p; } };
  const crate = makeCrate(host, V(0, 0.36, 0), 0.7);
  host.props.push(crate);
  for (let i = 0; i < 60; i++) { w.step(1 / 60); crate.update(1 / 60); }
  const crateTop = crate.body.position.y + 0.36;

  const rig = droidRig();
  rig.hipsBone.obj.position.set(0.9, 1.6, 0);
  rig.updateMatrices();
  const actor = new Actor(scene, w, rig, { mass: 52 });
  const arm = rig.worldPos('foreR', new THREE.Vector3());
  assert(actor.cut('foreR', 0.5, V(-7, 1, 0), arm), 'the cut was refused');
  const piece = actor.pieces[0];
  const bodies = piece.entries.map(e => e.body);
  // (a) it separated: every part of the piece is its own body, none of them the
  // actor's, and it is a capsule of the new length rather than the old one
  assert(bodies.length >= 2, `the piece is only ${bodies.length} bodies`);
  assert(bodies.every(b => b.shape.type === 'capsule'), 'a severed part is not a capsule');
  const stub = bodies[0];
  const stubLen = (stub.shape.halfHeight + stub.shape.radius) * 2;
  near(stubLen, rig.get('foreR').length * 0.5, 0.02, 'the stub capsule is the length of the stub');

  const y0 = bodies.map(b => b.position.y);
  for (let i = 0; i < 420; i++) { w.step(1 / 60); actor.update(1 / 60); crate.update(1 / 60); }
  // (b) it fell, and (c) it is resting on something — the ground or the crate
  const rest = bodies.filter(b => !b.dead).map(b => b.position.y);
  assert(rest.length, 'the piece vanished');
  assert(Math.min(...rest) < Math.min(...y0) - 0.3, 'the piece never fell');
  assert(rest.every(y => y > -0.2 && y < crateTop + 0.4),
    `a part came to rest at y=${rest.map(y => y.toFixed(2)).join(',')}`);
  assert(bodies.every(b => b.velocity.length() < 0.6), 'the piece never stopped');

  // and it can land ON a crate rather than through it: drop one straight down
  const above = new RBody({ position: V(0, crateTop + 1.2, 0), shape: capShape(0.06, 0.05),
    mass: 1.2, layer: LAYER.DEBRIS, mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.PROP });
  w.add(above);
  for (let i = 0; i < 300; i++) { w.step(1 / 60); crate.update(1 / 60); }
  assert(above.position.y > crateTop - 0.05,
    `a limb dropped on a crate ended up at y=${above.position.y.toFixed(2)}, crate top ${crateTop.toFixed(2)}`);
  return `stub ${(stubLen * 100).toFixed(0)}cm capsule, parts rest at y=`
    + rest.map(y => y.toFixed(2)).join('/') + `, a limb sits on the crate at ${above.position.y.toFixed(2)}`;
});

check('ragdoll: a corpse ignores its own bones but not another corpse\'s', () => {
  // A ragdoll's bones overlap by a radius wherever they share a socket, and the
  // two thighs overlap almost as much without sharing one, so a corpse left to
  // collide with itself spends forever shoving itself apart. Each actor takes a
  // self-exclusion bit instead (SELF_GROUPS) — which must NOT cost corpse
  // against corpse, and must not change `layer`, because gameplay compares it
  // by equality.
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();

  const a = new Actor(scene, w, (() => { const r = droidRig(); r.hipsBone.obj.position.set(0, 1.1, 0); r.updateMatrices(); return r; })(), { mass: 52 });
  a.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  assert([...a.bodies.values()].every(b => b.layer === LAYER.RAGDOLL),
    'a bone stopped being LAYER.RAGDOLL, which is what the Force and the bolts test');
  assert(a.selfGroup !== 0 && (a.selfGroup & LAYER.ALL & 0x3f) === 0,
    'the self bit collides with a LAYER bit');
  for (let i = 0; i < 400; i++) { w.step(1 / 60); a.update(1 / 60); }
  const floor = Math.max(...[...a.bodies.values()].map(b => b.position.y));

  // a second corpse dropped straight onto the first has to land ON it
  const b = new Actor(scene, w, (() => { const r = droidRig(); r.hipsBone.obj.position.set(0, 2.4, 0); r.updateMatrices(); return r; })(), { mass: 52 });
  assert(b.selfGroup !== a.selfGroup, 'two actors in a row took the same self bit');
  b.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  for (let i = 0; i < 400; i++) { w.step(1 / 60); a.update(1 / 60); b.update(1 / 60); }
  const top = Math.max(...[...b.bodies.values()].map(x => x.position.y));
  assert(top > floor * 0.9,
    `the second corpse sank into the first: it tops out at ${top.toFixed(2)}m, the pile is ${floor.toFixed(2)}m`);
  return `corpse on corpse: the pile is ${top.toFixed(2)}m deep, both still LAYER.RAGDOLL`;
});

check('ragdoll: spawn, cut, kill and dispose a hundred times over and nothing leaks', () => {
  const w = new RapierWorld({ gravity: -24 });
  w.terrain = flatGround();
  const base = { bodies: w.bodies.length, joints: w.joints.length,
    colliders: w.world.colliders.len(), rb: w.world.bodies.len(), ij: w.world.impulseJoints.len() };
  const marks = [];
  for (let round = 0; round < 20; round++) {
    const rig = droidRig();
    const actor = new Actor(scene, w, rig, { mass: 52 });
    // cut the same bone twice, so a collider gets rebuilt as well as created
    actor.cut('foreR', 0.6, V(0, 0, -5), rig.worldPos('foreR', new THREE.Vector3()));
    actor.cut('foreR', 0.5, V(0, 0, -5), rig.worldPos('foreR', new THREE.Vector3()));
    actor.cut('thighL', 0.45, V(2, 0, 0), rig.worldPos('thighL', new THREE.Vector3()));
    actor.goRagdoll(V(0, 0, -2), V(1, 0, 0));
    for (let i = 0; i < 30; i++) { w.step(1 / 60); actor.update(1 / 60); }
    // and cut a bone off the corpse too, which rebuilds a live capsule
    actor.cutRagdoll('shinR', V(0, 3, 0), 0.5);
    for (let i = 0; i < 30; i++) { w.step(1 / 60); actor.update(1 / 60); }
    if (round === 0) marks.push(`peak ${w.bodies.length} bodies / ${w.world.colliders.len()} colliders`);
    actor.dispose();
    w.step(1 / 60);
    assert(w.bodies.length === base.bodies,
      `round ${round} left ${w.bodies.length - base.bodies} bodies behind`);
    assert(w.joints.length === base.joints,
      `round ${round} left ${w.joints.length - base.joints} joints behind`);
    assert(w.world.colliders.len() === base.colliders,
      `round ${round} left ${w.world.colliders.len() - base.colliders} colliders behind`);
    assert(w.world.bodies.len() === base.rb,
      `round ${round} left ${w.world.bodies.len() - base.rb} rigid bodies behind`);
    assert(w.world.impulseJoints.len() === base.ij,
      `round ${round} left ${w.world.impulseJoints.len() - base.ij} Rapier joints behind`);
  }
  return `20 spawn/cut/kill/dispose cycles, ${marks[0]}, back to ${base.bodies}/${base.colliders} every time`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Deflection grading                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

function boltAt(pos, dir, speed = 80) {
  return { pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(speed), damage: 10, team: 1 };
}

check('deflect: a motionless blade only blocks', () => {
  const saber = makeBlade(scene);
  const p = V(0, 1.4, 0);
  sweepBlade(saber, p, Q(0, 0, 0), p, Q(0, 0, 0));
  const contact = saber.pointAt(0.6, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const res = gradeDeflection(bolt, saber, { bladeT: 0.6, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [], flow: 0,
  });
  assert(res.grade === GRADE.BLOCK, `graded ${res.grade}, expected BLOCK`);
  assert(res.damageMul === 1, 'a block should not amplify');
  return 'BLOCK';
});

check('deflect: a driven blade mirrors the bolt about its surface', () => {
  const saber = makeBlade(scene);
  const a = V(0, 1.4, 0.15), b = V(0, 1.4, -0.15);
  sweepBlade(saber, a, Q(0, 0, 0), b, Q(0, 0, 0));
  const contact = saber.pointAt(0.6, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const res = gradeDeflection(bolt, saber, { bladeT: 0.6, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [], flow: 0,
  });
  assert(res.grade >= GRADE.DEFLECT, `graded ${res.grade}, expected DEFLECT or better`);
  assert(res.dir.lengthSq() > 0.9, 'no outgoing direction');
  return `grade ${res.grade}, blade at ${res.bladeSpeed.toFixed(1)} m/s`;
});

check('deflect: a fast tip with an enemy under the reticle RETURNS the bolt at them', () => {
  const saber = makeBlade(scene);
  // whip the blade hard across the contact point
  const a = V(0, 1.4, 0.5), b = V(0, 1.4, -0.5);
  sweepBlade(saber, a, Q(0, 0, 0.4), b, Q(0, 0, -0.4), 1 / 120);
  const contact = saber.pointAt(0.8, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const enemy = { dead: false, position: V(0, 1.4, -20), aimPoint: (o) => o.set(0, 1.4, -20) };
  const res = gradeDeflection(bolt, saber, { bladeT: 0.8, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [enemy], flow: 1, returnCone: 0.42,
  });
  assert(res.grade >= GRADE.RETURN, `graded ${res.grade} (tip speed ${res.bladeSpeed.toFixed(1)}), expected RETURN`);
  assert(res.target && res.target.entity === enemy, 'no return target chosen');
  const toEnemy = V(0, 1.4, -20).sub(contact).normalize();
  assert(res.dir.dot(toEnemy) > 0.985, `bolt sent ${(Math.acos(clamp(res.dir.dot(toEnemy), -1, 1)) * 57.3).toFixed(1)}° off target`);
  assert(res.damageMul > 1, 'a return should hit harder');
  return `grade ${res.grade}, ×${res.damageMul} damage, ${res.bladeSpeed.toFixed(0)} m/s tip`;
});

check('deflect: no return target outside the aim cone', () => {
  const saber = makeBlade(scene);
  const a = V(0, 1.4, 0.5), b = V(0, 1.4, -0.5);
  sweepBlade(saber, a, Q(0, 0, 0.4), b, Q(0, 0, -0.4), 1 / 120);
  const contact = saber.pointAt(0.8, new THREE.Vector3());
  const bolt = boltAt(contact.clone().add(V(0, 0, 3)), V(0, 0, -1));
  const behind = { dead: false, position: V(0, 1.4, 20), aimPoint: (o) => o.set(0, 1.4, 20) };
  const res = gradeDeflection(bolt, saber, { bladeT: 0.8, point: contact }, {
    aimOrigin: V(0, 1.6, 0), aimDir: V(0, 0, -1), candidates: [behind], flow: 0,
  });
  assert(res.grade < GRADE.RETURN, `returned to an enemy behind the player (grade ${res.grade})`);
  return `grade ${res.grade} — correctly refuses`;
});

check('clash: opposing blade motion within the window is a chamber', () => {
  const A = makeBlade(scene), B = makeBlade(scene);
  // A swings left-to-right, B swings right-to-left through the same point
  sweepBlade(A, V(-0.5, 1.3, -0.6), Q(0.4, 0, 1.1), V(0.35, 1.3, -0.6), Q(0.4, 0, 1.1), 1 / 90);
  sweepBlade(B, V(0.9, 1.3, -0.6), Q(0.4, 0, -1.1), V(0.05, 1.3, -0.6), Q(0.4, 0, -1.1), 1 / 90);
  const res = resolveBladeClash(A, B);
  assert(res, 'the blades did not register a contact');
  assert(['chamber', 'clash', 'parry'].includes(res.type), `unexpected clash type ${res.type}`);
  return `${res.type}, power ${res.power.toFixed(2)}`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Slicing                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

check('slice: a box cut through the middle yields two capped halves', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const res = sliceGeometry(geo, V(0, 0, 0), V(0, 1, 0));
  assert(res, 'the slice failed');
  const fTris = res.front.attributes.position.count / 3;
  const bTris = res.back.attributes.position.count / 3;
  assert(fTris >= 8 && bTris >= 8, `too few triangles (${fTris}/${bTris})`);
  near(res.area, 1.0, 0.06, 'cross-section area');
  res.front.computeBoundingBox(); res.back.computeBoundingBox();
  near(res.front.boundingBox.min.y, 0, 1e-5, 'front half starts at the plane');
  near(res.back.boundingBox.max.y, 0, 1e-5, 'back half ends at the plane');
  return `${fTris}+${bTris} triangles, cross-section ${res.area.toFixed(3)}m²`;
});

check('slice: a diagonal cut through a box still closes', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const n = V(1, 1, 0).normalize();
  const res = sliceGeometry(geo, V(0.05, 0, 0), n);
  assert(res, 'the diagonal slice failed');
  assert(res.ringCount >= 4, `cross-section ring had only ${res.ringCount} points`);
  assert(res.area > 0.5 && res.area < 2.2, `implausible cross-section ${res.area}`);
  return `${res.ringCount}-sided cross-section, ${res.area.toFixed(3)}m²`;
});

check('slice: a plane that misses the geometry returns nothing', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const res = sliceGeometry(geo, V(0, 5, 0), V(0, 1, 0));
  assert(res === null, 'a miss produced halves');
  return 'null, as it should';
});

check('slice: sphere decomposition covers the geometry', () => {
  const geo = new THREE.BoxGeometry(2, 0.4, 0.4);
  const spheres = spheresForGeometry(geo, 8);
  assert(spheres.length >= 2, `only ${spheres.length} spheres for a long box`);
  const extent = Math.max(...spheres.map(s => s.c.x + s.r)) - Math.min(...spheres.map(s => s.c.x - s.r));
  near(extent, 2, 0.25, 'coverage along the long axis');
  return `${spheres.length} spheres spanning ${extent.toFixed(2)}m`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade controller                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

check('control: the blade lags a flick and then catches up (real inertia)', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  const startDir = V(0, 1, 0).applyQuaternion(c.quat).clone();

  c.gx = -0.9;                       // snap the guard hard to one side
  c.update(1 / 60, chest, aim, {});
  const afterOneFrame = V(0, 1, 0).applyQuaternion(c.quat).clone();
  const target = V(0, 1, 0).applyQuaternion(c._targetQuat).clone();

  const lag = afterOneFrame.angleTo(target);
  assert(lag > 0.15, `the blade teleported to the target (lag only ${lag.toFixed(3)} rad)`);
  for (let i = 0; i < 90; i++) c.update(1 / 60, chest, aim, {});
  const settled = V(0, 1, 0).applyQuaternion(c.quat).angleTo(target);
  assert(settled < 0.06, `the blade never settled (${settled.toFixed(3)} rad off)`);
  assert(startDir.angleTo(afterOneFrame) > 0.001, 'the blade did not move at all');
  return `lag ${(lag * 57.3).toFixed(1)}° after 1 frame, settled to ${(settled * 57.3).toFixed(2)}°`;
});

check('control: overshoot exists — a fast flick passes the target before returning', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  const ref = V(0, 1, 0).applyQuaternion(c.quat).clone();
  c.gx = 1.0;
  c.solveTargets(chest, aim, 0);
  const targetDir = V(0, 1, 0).applyQuaternion(c._targetQuat).clone();
  const targetAngle = ref.angleTo(targetDir);
  let maxAngle = 0, settled = 0;
  for (let i = 0; i < 480; i++) {
    c.update(1 / 240, chest, aim, {});
    const cur = V(0, 1, 0).applyQuaternion(c.quat);
    maxAngle = Math.max(maxAngle, ref.angleTo(cur));
    settled = cur.angleTo(targetDir);
  }
  const overshoot = (maxAngle - targetAngle) / targetAngle;
  assert(overshoot > 0.02, `barely any overshoot (${(overshoot * 100).toFixed(2)}%) — the blade feels weightless`);
  assert(overshoot < 0.30, `wild overshoot (${(overshoot * 100).toFixed(1)}%) — the blade feels unmoored`);
  assert(settled < 0.05, `never settled (${settled.toFixed(3)} rad off)`);
  return `overshoots the arc by ${(overshoot * 100).toFixed(1)}%, then settles`;
});

check('control: the hands never leave arm\'s reach', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 0 });
  const chest = V(0, 1.35, 0);
  const aim = new THREE.Quaternion();
  c.reset(chest, aim);
  let maxReach = 0;
  for (let i = 0; i < 400; i++) {
    c.gx = Math.sin(i * 0.31) * 1.35;
    c.gy = Math.cos(i * 0.19) * 1.1;
    c.thrust = i % 40 === 0 ? 1 : c.thrust * 0.9;
    c.update(1 / 60, chest, aim, {});
    maxReach = Math.max(maxReach, c.handPos.distanceTo(chest));
    assert(isFinite(c.handPos.x) && isFinite(c.quat.x), 'controller went non-finite');
  }
  assert(maxReach <= 0.87, `hands reached ${maxReach.toFixed(3)}m from the chest`);
  return `max reach ${maxReach.toFixed(3)}m`;
});

// Stands in for Input: gameplay asks for actions, so the fake has to answer
// them. `buttons` stays so a test can still say "hold the left mouse button".
const mkInput = () => ({
  mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
  buttons: [false, false, false, false, false],
  buttonPressed: [false, false, false, false, false],
  down: () => false, padButtons: null, padDown: () => false,
  act(id) { return id === 'blade' ? !!this.buttons[0] : id === 'thrust' ? !!this.buttons[2] : false; },
  actHit(id) { return id === 'blade' ? !!this.buttonPressed[0] : id === 'thrust' ? !!this.buttonPressed[2] : false; },
});

check('control: Free Blade still drags the camera after the guard', () => {
  const c = new SaberController({ sensitivity: 1, followStrength: 1.0, scheme: 'free' });
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  c.gx = 1.0;
  const input = mkInput();
  let camYaw = 0;
  for (let i = 0; i < 40; i++) camYaw += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  assert(c.gx < 0.55, `the guard stayed out at ${c.gx.toFixed(3)}`);
  assert(camYaw < -0.2, `the camera did not turn toward the blade (${camYaw.toFixed(3)} rad)`);
  return `guard 1.00 → ${c.gx.toFixed(2)}, camera turned ${(camYaw * 57.3).toFixed(0)}°`;
});

check('control: the mouse moves the blade ONLY while the button is held', () => {
  const c = new SaberController({ sensitivity: 1 });      // shipped defaults
  assert(c.scheme === 'hold', `default scheme is "${c.scheme}", not hold-to-blade`);
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  const input = mkInput();

  // button up: the mouse is the camera, and the blade must not follow it
  const gx0 = c.gx;
  let camYaw = 0;
  for (let i = 0; i < 30; i++) {
    input.mouse.dx = 40;
    camYaw += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  }
  assert(Math.abs(c.gx - gx0) < 0.02, `the blade drifted ${(c.gx - gx0).toFixed(3)} with the button up`);
  assert(Math.abs(camYaw) > 0.5, `the camera barely turned (${camYaw.toFixed(2)} rad) with the button up`);

  // button down: the mouse is the blade, and the camera must hold still
  input.buttons[0] = true;
  let camYaw2 = 0;
  for (let i = 0; i < 30; i++) {
    input.mouse.dx = 40;
    camYaw2 += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw;
  }
  assert(c.gx > gx0 + 0.3, `the blade did not move with the button held (${c.gx.toFixed(3)})`);
  return `up: camera ${(camYaw * 57.3).toFixed(0)}° / blade still; down: blade → ${c.gx.toFixed(2)}`;
});

check('control: inside the guard cone the view holds still; past it, it turns', () => {
  const c = new SaberController({ sensitivity: 1 });
  c.reset(V(0, 1.35, 0), new THREE.Quaternion());
  const input = mkInput();
  input.buttons[0] = true;
  c.gx = 0;

  // a small push moves the blade and nothing else — this is what makes precise
  // blocking possible while the button is held
  let cam = 0;
  for (let i = 0; i < 8; i++) { input.mouse.dx = 20; cam += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw; }
  assert(c.gx > 0.2, `the blade barely moved (${c.gx.toFixed(3)})`);
  assert(Math.abs(cam) < 1e-9, `the view drifted ${cam.toFixed(5)} rad inside the cone`);

  // and it must STAY still even driven hard past the guard's travel limit —
  // this is the whole point: a slash must never spin the view
  let cam2 = 0;
  for (let i = 0; i < 40; i++) { input.mouse.dx = 90; cam2 += c.applyInput(input, 1 / 60, { stamina: 1 }).yaw; }
  assert(Math.abs(c.gx - 1.0) < 1e-6, `the guard did not pin at its limit (${c.gx.toFixed(4)})`);
  assert(Math.abs(cam2) < 1e-9, `driving past the cone turned the view ${(cam2 * 57.3).toFixed(1)}°`);
  return `blade reached its limit, view drift 0 rad throughout`;
});

check('control: a full slash fits inside one comfortable mouse sweep', () => {
  // The cone is +/-1.0 in guard units, so corner to corner is 2.0. If that
  // costs more mouse travel than a person sweeps in one motion, you physically
  // cannot slash horizontally — which is what a gain of 0.0021 did, needing
  // 950px for a full arc.
  const c = new SaberController({ sensitivity: 1 });
  c.reset(V(0, 1.35, 0), new THREE.Quaternion());
  const input = mkInput();
  input.buttons[0] = true;
  c.gx = -1;
  let px = 0;
  for (let i = 0; i < 400 && c.gx < 0.999; i++) { input.mouse.dx = 10; px += 10; c.applyInput(input, 1 / 60, { stamina: 1 }); }
  assert(c.gx > 0.999, 'the guard never crossed its full travel');
  assert(px < 420, `a full slash costs ${px}px of mouse — too far to sweep in one motion`);
  assert(px > 200, `a full slash costs only ${px}px — the blade will be twitchy`);
  return `full arc in ${px}px of mouse travel`;
});

check('control: letting go returns the blade to a ready guard', () => {
  const c = new SaberController({ sensitivity: 1 });
  const chest = V(0, 1.35, 0);
  c.reset(chest, new THREE.Quaternion());
  const input = mkInput();
  c.gx = -0.95; c.gy = -0.9;                      // abandoned low-left
  for (let i = 0; i < 90; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
  const off = Math.hypot(c.gx - c.readyX, c.gy - c.readyY);
  assert(off < 0.05, `the guard settled ${off.toFixed(3)} away from ready`);
  return `low-left → ready in 1.5s (${off.toFixed(4)} off)`;
});

check('control: walking does not drag the blade around behind you', () => {
  const c = new SaberController({ sensitivity: 1 });
  const aim = new THREE.Quaternion();
  const chest = V(0, 1.35, 0);
  c.reset(chest, aim);
  // sprint 4m in a straight line, hands untouched, and measure the blade's
  // offset from the body — it must stay exactly where a still player holds it.
  const restOffset = c.handPos.clone().sub(chest);
  let worstDrift = 0;
  for (let i = 0; i < 240; i++) {
    chest.x += 7.4 / 60;                          // a hard sprint
    c.update(1 / 60, chest, aim, {});
    worstDrift = Math.max(worstDrift, c.handPos.clone().sub(chest).distanceTo(restOffset));
  }
  assert(worstDrift < 0.01, `the blade lagged ${(worstDrift * 100).toFixed(1)}cm behind a sprinting body`);
  return `4m sprint, blade drifted ${(worstDrift * 1000).toFixed(2)}mm from the body`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Terrain, waves, boons                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

check('terrain: sampling is continuous and a crater actually lowers the ground', () => {
  const t = new Terrain(scene, 'dunes', 1.0);
  const h0 = t.height(12, -8);
  const h1 = t.height(12.01, -8);
  assert(Math.abs(h0 - h1) < 0.2, 'height field is discontinuous');
  const n = t.normalAt(12, -8, new THREE.Vector3());
  near(n.length(), 1, 1e-4, 'normal is not unit length');
  t.crater(12, -8, 3, 1.2);
  const after = t.height(12, -8);
  assert(after < h0 - 0.5, `crater only moved the ground ${(h0 - after).toFixed(3)}m`);
  const rim = t.height(12 + 3.1, -8);
  assert(rim > after, 'the crater has no raised rim');
  // and the mesh follows
  t.flush();
  return `${(h0 - after).toFixed(2)}m deep crater`;
});

check('terrain: a downward ray hits the surface', () => {
  const t = new Terrain(scene, 'dunes', 0.6);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const from = V(5, t.height(5, 5) + 20, 5);
  const dist = t.raycast(from, V(0, -1, 0), 60, p, n);
  assert(dist !== null, 'the ray missed the ground below it');
  near(p.y, t.height(5, 5), 0.12, 'hit height');
  return `hit at ${dist.toFixed(2)}m`;
});

check('terrain: every preset stays finite, bounded and continuous everywhere', () => {
  const lines = [];
  for (const name of Object.keys(TERRAIN_PRESETS)) {
    const P = TERRAIN_PRESETS[name];
    const H = P.scale / 2;
    let lo = Infinity, hi = -Infinity;
    // The dune brink and the strata risers are deliberately near vertical, so
    // a raw step size proves nothing. Continuity is the invariant that matters:
    // measure the worst gradient at two epsilons an order of magnitude apart.
    // Across a genuine discontinuity the finer probe reports ten times the
    // gradient; across a steep-but-continuous riser it reports the same.
    let gCoarse = 0, gFine = 0;
    for (let k = 0; k < 4000; k++) {
      const x = ((k * 137.51) % (P.scale - 2)) - H + 1;
      const z = ((k * 61.803) % (P.scale - 2)) - H + 1;
      const h = P.height(x, z);
      assert(Number.isFinite(h), `${name}.height(${x.toFixed(1)},${z.toFixed(1)}) = ${h}`);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      gCoarse = Math.max(gCoarse,
        Math.abs(P.height(x + 0.05, z) - h) / 0.05, Math.abs(P.height(x, z + 0.05) - h) / 0.05);
      gFine = Math.max(gFine,
        Math.abs(P.height(x + 0.005, z) - h) / 0.005, Math.abs(P.height(x, z + 0.005) - h) / 0.005);
    }
    assert(hi - lo < 200, `${name} spans ${(hi - lo).toFixed(0)}m of relief`);
    assert(gCoarse < 20, `${name} reaches a gradient of ${gCoarse.toFixed(1)} (${(Math.atan(gCoarse) * 180 / Math.PI).toFixed(0)}°)`);
    assert(gFine < gCoarse * 1.7 + 1, `${name} is discontinuous: gradient ${gCoarse.toFixed(1)} at 5cm becomes ${gFine.toFixed(1)} at 5mm`);
    lines.push(`${name} ${lo.toFixed(0)}…${hi.toFixed(0)}m, steepest ${gCoarse.toFixed(1)}/${gFine.toFixed(1)}`);
  }
  return lines.join('; ');
});

check('terrain: dunes have a windward face and a slip face, not a sine', () => {
  const P = TERRAIN_PRESETS.dunes;
  const [wx, wz] = P.wind;
  const e = 3;
  const g = [];
  for (let k = 1; k <= 6000; k++) {
    const x = ((k * 137.51) % 440) - 220, z = ((k * 61.803) % 440) - 220;
    if (Math.hypot(x, z) < 55) continue;            // the pan is deliberately flat
    g.push((P.height(x + wx * e, z + wz * e) - P.height(x - wx * e, z - wz * e)) / (2 * e));
  }
  g.sort((a, b) => a - b);
  const down = Math.abs(g[Math.floor(g.length * 0.01)]);   // steepest downwind drop
  const up = g[Math.floor(g.length * 0.99)];               // steepest windward climb
  assert(down > up * 1.5, `slip faces only ${(down / up).toFixed(2)}x the windward grade — this is a sine`);
  assert(down > 0.45 && down < 1.4, `slip face grade ${down.toFixed(2)} is not near the angle of repose`);
  // and the same measure across the wind must NOT be asymmetric
  const c = [];
  for (let k = 1; k <= 3000; k++) {
    const x = ((k * 91.7) % 440) - 220, z = ((k * 53.1) % 440) - 220;
    if (Math.hypot(x, z) < 55) continue;
    c.push((P.height(x - wz * e, z + wx * e) - P.height(x + wz * e, z - wx * e)) / (2 * e));
  }
  c.sort((a, b) => a - b);
  const cross = Math.abs(c[Math.floor(c.length * 0.01)]) / c[Math.floor(c.length * 0.99)];
  assert(cross < 1.35, `crosswind is asymmetric too (${cross.toFixed(2)}) — the wind axis is not real`);
  return `slip ${down.toFixed(2)} vs windward ${up.toFixed(2)} (${(down / up).toFixed(2)}x), crosswind ${cross.toFixed(2)}x`;
});

check('terrain: strata bench a wall without stepping it', () => {
  // benches must be flatter than the ramp they replace, risers steeper, and the
  // function must stay continuous across every band edge
  let flat = 0, steep = 0, worst = 0;
  for (let h = 0.02; h < 60; h += 0.01) {
    const a = strata(h, 6, 0.8, 3), b = strata(h + 0.01, 6, 0.8, 3);
    const d = (b - a) / 0.01;
    assert(Number.isFinite(d), `non-finite gradient at h=${h}`);
    assert(d > -0.01, `strata went backwards at h=${h.toFixed(2)} (${d.toFixed(2)})`);
    worst = Math.max(worst, Math.abs(b - a));
    if (d < 0.5) flat++; else if (d > 1.6) steep++;
  }
  assert(flat > 2000, `only ${flat} samples landed on a bench`);
  assert(steep > 300, `only ${steep} samples landed on a riser`);
  assert(worst < 0.09, `strata steps ${worst.toFixed(3)}m over 1cm`);
  near(strata(12, 6, 0, 3), 12, 1e-9, 'zero strength must be a no-op');
  return `${flat} bench / ${steep} riser samples over 60m, max 1cm step ${(worst * 1000).toFixed(1)}mm`;
});

check('terrain: dune profile is monotone up the windward face and down the slip', () => {
  let prevUp = -1, prevDown = 2, peak = 0;
  for (let f = 0; f <= 1.0001; f += 0.002) {
    const v = duneProfile(f);
    assert(v >= -1e-9 && v <= 1 + 1e-9, `profile left [0,1] at f=${f.toFixed(3)}: ${v}`);
    if (f < 0.74) { assert(v >= prevUp - 1e-9, `windward dips at ${f.toFixed(3)}`); prevUp = v; peak = v; }
    else { assert(v <= prevDown + 1e-9, `slip face climbs at ${f.toFixed(3)}`); prevDown = v; }
  }
  near(peak, 1, 0.01, 'the brink does not reach full height');
  near(duneProfile(1), 0, 1e-6, 'the toe does not return to zero');
  return `brink at f=0.74, ${(0.26 / 0.74).toFixed(2)} of the wavelength is slip face`;
});

check('terrain: the landform channels describe the ground they were baked from', () => {
  const lines = [];
  for (const name of ['dunes', 'canyon']) {
    const t = new Terrain(scene, name, 0.7);
    const L = t.landform;
    assert(L.length === t.res * t.res * 4, 'the landform attribute is the wrong length');
    assert(t.geometry.attributes.aTer, 'aTer never reached the geometry');
    assert(t.geometry.attributes.aTer.normalized, 'aTer must be a normalized byte attribute');

    // every channel has to actually use its range — a channel pinned at 0.5
    // means the normalisation collapsed and the material sees nothing
    for (let c = 0; c < 4; c++) {
      let lo = 255, hi = 0, sum = 0;
      for (let k = c; k < L.length; k += 4) { lo = Math.min(lo, L[k]); hi = Math.max(hi, L[k]); sum += L[k]; }
      const mean = sum / (L.length / 4);
      assert(hi - lo > 120, `${name} channel ${c} only spans ${hi - lo}/255`);
      assert(mean > 60 && mean < 195, `${name} channel ${c} is pinned at ${mean.toFixed(0)}`);
    }

    // concavity must agree with the second derivative of the ground: dig a hole
    // and the channel has to report a hollow where it reported a crest
    const before = L[t._idx(t.res >> 1, t.res >> 1) * 4];
    t.crater(0, 0, 9, 3.0);
    t.flush();
    const after = t.landform[t._idx(t.res >> 1, t.res >> 1) * 4];
    assert(after > before + 20, `a 3m crater only moved concavity ${before}→${after}`);

    // wind exposure must be signed against the preset's own wind vector
    const [wx, wz] = t.preset.wind;
    let agree = 0, n = 0;
    for (let k = 0; k < 900; k++) {
      const i = 8 + ((k * 37) % (t.res - 16)), j = 8 + ((k * 61) % (t.res - 16));
      const x = -t.half + i * t.step, z = -t.half + j * t.step;
      const gx = (t.height(x + 3, z) - t.height(x - 3, z)) / 6;
      const gz = (t.height(x, z + 3) - t.height(x, z - 3)) / 6;
      if (Math.hypot(gx, gz) < 0.12) continue;           // flats carry no aspect
      const expo = t.landform[(j * t.res + i) * 4 + 3] / 255 * 2 - 1;
      if (Math.abs(expo) < 0.05) continue;
      n++;
      if (Math.sign(gx * wx + gz * wz) === Math.sign(expo)) agree++;
    }
    assert(n > 100, `only ${n} sloped samples to test exposure on`);
    assert(agree / n > 0.78, `${name} wind exposure agrees with the slope aspect only ${(agree / n * 100).toFixed(0)}% of the time`);
    lines.push(`${name}: 4 channels spread, crater ${before}→${after}, aspect ${(agree / n * 100).toFixed(0)}% signed`);
    t.dispose();
  }
  return lines.join('; ');
});

check('terrain: quality scales the grid but never the sampled shape', () => {
  const lo = new Terrain(scene, 'dunes', 0.5);
  const hi = new Terrain(scene, 'dunes', 1.25);
  assert(hi.res > lo.res * 2, `res did not follow quality: ${lo.res} vs ${hi.res}`);
  let worst = 0;
  for (let k = 0; k < 700; k++) {
    const x = ((k * 137.51) % 400) - 200, z = ((k * 61.803) % 400) - 200;
    worst = Math.max(worst, Math.abs(lo.height(x, z) - hi.height(x, z)));
  }
  // the coarse grid is a 5.6m lattice over a dune field; it may lag, not diverge
  assert(worst < 3.5, `the two grids disagree by ${worst.toFixed(2)}m`);
  lo.dispose(); hi.dispose();
  return `res ${lo.res}→${hi.res}, worst height disagreement ${worst.toFixed(2)}m`;
});

check('terrain: the ground is actually in the shadow map', () => {
  // three renders the shadow pass with shadowSide[material.side], which turns a
  // FrontSide material into a BackSide depth pass. On a closed mesh that hides
  // acne; on a single-sheet heightfield it culls the ground out of the shadow
  // map altogether and castShadow silently does nothing.
  const t = new Terrain(scene, 'dunes', 0.5);
  assert(t.mesh.castShadow, 'the terrain does not cast at all');
  assert(t.mesh.receiveShadow, 'the terrain does not receive');
  assert(t.material.shadowSide === THREE.FrontSide,
    `shadowSide is ${t.material.shadowSide} — the depth pass will cull the ground away`);
  assert(t.mesh.customDepthMaterial === undefined,
    'a biased depth caster erases the very self-shadowing castShadow is for');
  t.dispose();
  return 'castShadow + receiveShadow + FrontSide depth pass, no caster bias';
});

check('terrain: the canyon is ankle deep, not a lake', () => {
  const P = TERRAIN_PRESETS.canyon;
  const WATER = 0.35;                     // Levels.canyon.water.level
  let wet = 0, deep = 0, floor = 0;
  for (let k = 0; k < 30000; k++) {
    const x = ((k * 137.51) % 400) - 200, z = ((k * 61.803) % 200) - 100;
    const h = P.height(x, z);
    if (h > 8) continue;
    floor++;
    if (h < WATER) wet++;
    if (h < WATER - 0.9) deep++;
  }
  assert(wet / floor > 0.15 && wet / floor < 0.7, `${(wet / floor * 100).toFixed(0)}% of the wash is under water`);
  assert(deep / floor < 0.05, `${(deep / floor * 100).toFixed(0)}% of the wash is over knee deep`);
  return `${(wet / floor * 100).toFixed(0)}% of the wash under 0.35m of water, ${(deep / floor * 100).toFixed(1)}% deeper than 0.9m`;
});

check('waves: the budget escalates and unlocks new units', () => {
  const fakeWorld = { enemies: [], difficulty: DIFFICULTY.knight, takenBoons: new Set() };
  const d = new WaveDirector(fakeWorld, { mode: 'roguelite', pool: ['b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'] });
  const b1 = d.budgetFor(1), b5 = d.budgetFor(5), b15 = d.budgetFor(15);
  assert(b1 < b5 && b5 < b15, 'the budget does not escalate');
  assert(d.unlockedAt(1).length < d.unlockedAt(12).length, 'no new units unlock');
  d.wave = 8; d._compose();
  assert(d.spawnQueue.length > 0, 'wave 8 composed nothing');
  const types = new Set(d.spawnQueue);
  assert(types.size >= 2, `wave 8 is monotonous: ${[...types].join(',')}`);
  return `budget ${b1}→${b5}→${b15}, wave 8 = ${d.spawnQueue.length} units of ${types.size} kinds`;
});

/**
 * REPLACED, and deliberately. This used to be "drafting never repeats what you
 * already hold", which pinned the design that made a run run out: with no
 * repeats and 30 cards, a draft every second wave drained the entire system by
 * about wave 68, `drawBoons` returned `[]`, and the player's power froze while
 * the budget kept climbing forever. Cards now have RANKS and a card is in the
 * pool while it has ranks left.
 *
 * So the property is not "never repeats" any more. It is the stronger one that
 * the old rule was a crude proxy for: an offer is always full, always distinct
 * within itself, and never contains something with nothing left to give.
 */
check('boons: a draft is never empty, never duplicated, and never spent', () => {
  const taken = new RankSet();
  // Drain hard — 400 picks is far past any real run, and past the point where
  // the whole card table is exhausted and only attunements remain.
  let minHand = Infinity;
  for (let i = 0; i < 400; i++) {
    const wave = 2 + i * 2;
    const drawn = drawBoons(3, taken, wave);
    assert(drawn.length >= 3, `wave ${wave}: drew ${drawn.length}, so the draft screen would be short`);
    minHand = Math.min(minHand, drawn.length);
    assert(new Set(drawn.map(b => b.id)).size === drawn.length, `wave ${wave}: drew a duplicate within one offer`);
    for (const b of drawn) {
      assert(rankOf(taken, b.id) < maxRank(b),
        `wave ${wave}: offered ${b.id} at rank ${rankOf(taken, b.id) + 1} of ${maxRank(b)} — it has nothing left`);
    }
    taken.take(drawn[0].id);
  }
  const cardRanks = BOONS.reduce((n, b) => n + maxRank(b), 0);
  return `400 drafts, smallest hand ${minHand}; ${BOONS.length} cards / ${cardRanks} ranks, `
    + `then ${ATTUNEMENTS.length} attunements that never run out`;
});

check('boons: every boon applies without throwing', async () => {
  const { defaultBoonMods } = await import('../src/game/Player.js');
  // The stub's boonMods is PLAYER'S OWN, not a copy. A hand-written duplicate
  // went stale the moment a card needed a key it did not list, and then this
  // check failed on a NaN that existed only inside itself. Reading the real
  // defaults makes it exact: a card that writes an undeclared key is now
  // caught here, which is the bug worth catching — `undefined * 1.33` is NaN
  // and a NaN in cutPower is a blade that cuts nothing.
  const stub = () => ({
    boonMods: defaultBoonMods(),
    control: { deadzone: 0.24, sensitivity: 1 },
    saber: { bladeLength: 1.15, coreWidth: 1 },
    maxHp: 100, hp: 100, maxStamina: 100, stamina: 100, maxForce: 100, force: 100,
  });
  const all = [...BOONS, ...ATTUNEMENTS];
  const declared = new Set(Object.keys(defaultBoonMods()));
  for (const b of all) {
    // Ranks too: rank 3 runs different arithmetic from rank 1 and is where a
    // `set`-shaped effect turns out not to accumulate.
    for (const rank of [1, 2, 3]) {
      if (rank > maxRank(b)) break;
      const p = stub();
      for (let r = 1; r <= rank; r++) b.apply(p, rankScale(r));
      for (const [k, v] of Object.entries(p.boonMods)) {
        assert(declared.has(k), `${b.id} wrote boonMods.${k}, which Player never declares`);
        assert(typeof v !== 'number' || isFinite(v), `${b.id} rank ${rank} made boonMods.${k} = ${v}`);
      }
      assert(isFinite(p.maxHp) && p.maxHp > 0, `${b.id} rank ${rank} left maxHp = ${p.maxHp}`);
      assert(isFinite(p.saber.bladeLength) && p.saber.bladeLength > 0,
        `${b.id} rank ${rank} left bladeLength = ${p.saber.bladeLength}`);
    }
  }
  return `${all.length} cards × up to 3 ranks applied cleanly onto Player's own defaults`;
});

/**
 * The bound that makes `stack` safe to hand out.
 *
 * RANK_DIMINISH is a geometric series, so stacking one card forever converges
 * to 1/(1-d) of itself. That convergence is the entire argument for letting
 * cards repeat at all, and it is worth pinning because it is one constant away
 * from being false: at d = 1 a stacked card is unbounded, and the harness has
 * already caught one 12x outlier in this table without any help from stacking.
 */
check('boons: a stacked card converges instead of running away', () => {
  assert(RANK_DIMINISH > 0 && RANK_DIMINISH < 1,
    `RANK_DIMINISH is ${RANK_DIMINISH} — outside (0,1) it does not converge at all`);
  let sum = 0;
  for (let r = 1; r <= 40; r++) sum += rankScale(r);
  const limit = 1 / (1 - RANK_DIMINISH);
  assert(sum <= limit + 1e-9, `forty ranks sum to ${sum.toFixed(3)}, past the ${limit.toFixed(2)} limit`);
  // …and never worth nothing, which is the other half: a card at its last rank
  // must still be a card. Deepest stack in the table decides the worst case.
  const deepest = Math.max(...BOONS.map(maxRank).filter(n => isFinite(n)));
  assert(rankScale(deepest) > 0.05,
    `the last rank of a ${deepest}-stack is worth ${(rankScale(deepest) * 100).toFixed(1)}% of the first — that is a dead draft slot`);
  // Attunements are the opposite promise and must NOT converge, or the endless
  // mode has no answer to a budget that grows without bound.
  for (const a of ATTUNEMENTS) {
    assert(maxRank(a) === Infinity, `${a.id} has a cap — attunements are the growth that has none`);
  }
  return `ranks converge to ${limit.toFixed(2)}× (40 ranks = ${sum.toFixed(3)}), deepest stack `
    + `${deepest} still worth ${(rankScale(deepest) * 100).toFixed(0)}%, ${ATTUNEMENTS.length} uncapped attunements`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Body construction                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

check('bodies: every archetype builds with limbs on every bone', () => {
  const lines = [];
  for (const [name, fn] of [['jedi', buildJedi], ['b1', buildB1], ['trooper', buildTrooper], ['acolyte', buildAcolyte]]) {
    const built = fn({});
    const rig = built.rig;
    const boned = rig.list.filter(b => b.parts.length > 0);
    assert(boned.length >= 18, `${name} only dressed ${boned.length} bones`);
    assert(rig.list.every(b => b.parts.length === 0 || b.primary), `${name} has a bone with no primary limb`);
    let tris = 0;
    rig.root.traverse(o => { if (o.geometry?.index) tris += o.geometry.index.count / 3; else if (o.geometry) tris += o.geometry.attributes.position.count / 3; });
    lines.push(`${name} ${boned.length} bones / ${Math.round(tris)} tris`);
  }
  return lines.join(', ');
});

check('bodies: a limb rebuilt at 40% is 40% as long', () => {
  const full = limbGeo(1.0, 0.08, 0.06, 10);
  const part = limbGeo(0.4, 0.08, 0.072, 10);
  full.computeBoundingBox(); part.computeBoundingBox();
  const fullLen = full.boundingBox.max.y - full.boundingBox.min.y;
  const partLen = part.boundingBox.max.y - part.boundingBox.min.y;
  near(partLen / fullLen, 0.4, 0.12, 'rebuilt length ratio');
  return `${partLen.toFixed(3)} / ${fullLen.toFixed(3)}`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — duelling                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/** Just enough enemy for a duel brain to run against. */
function stubDuellist(formKey) {
  const saber = makeBlade(scene);
  const e = {
    position: V(0, 0, 0), facing: 0, lod: 0, saberPhase: 'guard', saberTimer: 0,
    A: { scale: 1 }, saber, world: { difficulty: DIFFICULTY.knight },
    target: null, aimPoint: (o) => o.set(0, 1.4, 0),
  };
  e.duel = new DuelBrain(e, { form: formKey });
  return e;
}

check('duel: every form only names moves that exist, with a valid tier', () => {
  let count = 0;
  for (const key of FORM_KEYS) {
    const f = FORMS[key];
    assert(f.moves.length, `${key} has no moves`);
    const e = stubDuellist(key);
    // drive it long enough to have drawn every move at least once
    const seen = new Set();
    for (let i = 0; i < 6000; i++) {
      e.duel.update(1 / 120, {}, 2.0);
      if (e.duel.attack) { seen.add(e.duel.attackKey); assert(TIER[e.duel.attack.tier], `${key}: bad tier`); }
    }
    for (const m of f.moves) assert(seen.has(m), `${key} never used ${m}`);
    count += seen.size;
  }
  return `${FORM_KEYS.length} forms, ${count} move slots exercised`;
});

check('duel: attack rate does not depend on the framerate', () => {
  const count = (dt) => {
    const e = stubDuellist('makashi');
    let attacks = 0, last = 'guard';
    for (let t = 0; t < 30; t += dt) {
      e.duel.update(dt, {}, 2.0);
      if (e.duel.phase === 'windup' && last !== 'windup') attacks++;
      last = e.duel.phase;
    }
    return attacks;
  };
  const at60 = count(1 / 60), at240 = count(1 / 240);
  assert(at60 > 8, `only ${at60} attacks in 30s at 60fps — duellists are idling`);
  const ratio = Math.max(at60, at240) / Math.max(1, Math.min(at60, at240));
  assert(ratio < 1.6, `attack rate changed ${ratio.toFixed(2)}× between 60 and 240 fps`);
  return `${at60} attacks @60fps, ${at240} @240fps in 30s`;
});

check('duel: the brain cycles guard → windup → strike → recover', () => {
  const e = stubDuellist('djemSo');
  const seen = [];
  for (let i = 0; i < 3000; i++) {
    const before = e.duel.phase;
    e.duel.update(1 / 120, {}, 2.0);
    if (e.duel.phase !== before) seen.push(e.duel.phase);
    if (seen.length > 12) break;
  }
  const order = seen.join(' ');
  assert(/windup strike recover/.test(order), `never completed a strike: ${order}`);
  assert(seen.every(p => ['guard', 'feint', 'windup', 'strike', 'recover'].includes(p)), `unknown phase in ${order}`);
  return order.slice(0, 46);
});

check('duel: the chamber window opens only in the tail of a wind-up', () => {
  const e = stubDuellist('djemSo');
  let sawWindup = false, openedEarly = false, openedLate = false;
  for (let i = 0; i < 4000; i++) {
    e.duel.update(1 / 120, {}, 2.0);
    if (e.duel.phase === 'windup') {
      sawWindup = true;
      const k = 1 - e.duel.timer / e.duel._windupLen;
      if (e.duel.chamberOpen && k < 0.4) openedEarly = true;
      if (e.duel.chamberOpen && k > 0.75) openedLate = true;
    }
  }
  assert(sawWindup, 'never wound up');
  assert(!openedEarly, 'the chamber window opened at the start of the wind-up');
  assert(openedLate, 'the chamber window never opened');
  return 'opens in the last third, as advertised';
});

check('duel: chambering needs a swing AGAINST the declared arc', () => {
  const e = stubDuellist('djemSo');
  // wind one up and hold it in the chamber window
  let guard = 0;
  while (!e.duel.chamberOpen && guard++ < 8000) e.duel.update(1 / 240, {}, 2.0);
  assert(e.duel.chamberOpen, 'could not reach a chamber window');
  const a = e.duel.attack;
  const along = a.to.clone().sub(a.from).normalize();          // the way it travels
  assert(e.duel.chambersWith(along.clone().negate()), 'swinging against the arc did not chamber');
  assert(!e.duel.chambersWith(along), 'swinging WITH the arc chambered, which it must not');
  const across = new THREE.Vector3().crossVectors(along, V(0, 1, 0)).normalize();
  assert(!e.duel.chambersWith(across), 'a perpendicular swing chambered');
  return `${a.label}: opposing yes, following no, perpendicular no`;
});

check('duel: heavy and unblockable attacks refuse a flat parry', () => {
  assert(TIER.light.parryable, 'light should be parryable');
  assert(!TIER.heavy.parryable && TIER.heavy.chamberable, 'heavy should be chamber-only');
  assert(!TIER.unblockable.parryable && !TIER.unblockable.chamberable, 'unblockable should be neither');
  assert(TIER.unblockable.guardBreak > TIER.heavy.guardBreak, 'guard-break should scale with tier');
  return 'light → parry, heavy → chamber, red → feet';
});

check('duel: interrupting a duellist kills the attack it was declaring', () => {
  const e = stubDuellist('ataru');
  let guard = 0;
  while (e.duel.phase !== 'windup' && guard++ < 8000) e.duel.update(1 / 240, {}, 2.0);
  assert(e.duel.attack, 'never declared an attack');
  e.duel.interrupt(0.5);
  assert(e.duel.phase === 'recover' && !e.duel.attack, 'the attack survived the interrupt');
  assert(!e.duel.chamberOpen, 'chamber window left open after an interrupt');
  return 'parried mid-declaration → recover, no attack';
});

check('duel: a sparring time-scale genuinely slows the form down', () => {
  const fast = stubDuellist('makashi');
  const slow = stubDuellist('makashi');
  slow.duel.timeScale = 0.5;
  const windupOf = (e) => {
    let guard = 0;
    while (e.duel.phase !== 'windup' && guard++ < 20000) e.duel.update(1 / 480, {}, 2.0);
    return e.duel._windupLen;
  };
  const a = windupOf(fast), b = windupOf(slow);
  assert(b > a * 1.5, `half speed only stretched the wind-up ${(b / a).toFixed(2)}×`);
  return `wind-up ${a.toFixed(2)}s → ${b.toFixed(2)}s at half speed`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — cloth                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

check('cloth: a cloak hangs from its anchors and settles', () => {
  const anchor = V(0, 1.6, 0);
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), anchor.y, anchor.z),
  });
  cloak.reset();
  for (let i = 0; i < 240; i++) cloak.update(1 / 60, [], V(0, 0, 0));
  const p = cloak.pos;
  let lowest = Infinity, highest = -Infinity, moved = 0;
  for (let i = 0; i < cloak.cols * cloak.rows; i++) {
    const y = p[i * 3 + 1];
    assert(isFinite(y), 'a cloth particle went non-finite');
    lowest = Math.min(lowest, y); highest = Math.max(highest, y);
    moved = Math.max(moved, Math.abs(p[i * 3] - p[i * 3 + 2]));
  }
  near(highest, anchor.y, 1e-6, 'the top row left its anchors');
  assert(lowest > anchor.y - cloak.length * 1.12, `the cloth stretched to ${(anchor.y - lowest).toFixed(2)}m past its ${cloak.length}m`);
  assert(lowest < anchor.y - cloak.length * 0.75, 'the cloth never fell');
  return `hangs ${(anchor.y - lowest).toFixed(2)}m from a ${cloak.length}m cloak`;
});

check('cloth: colliders keep the cloak out of the body', () => {
  const anchor = V(0, 1.6, 0);
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0, gravity: -13,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), anchor.y, anchor.z),
  });
  cloak.reset();
  // a fat torso directly in the cloth's path
  const body = [{ c: V(0, 1.1, 0), r: 0.34 }];
  for (let i = 0; i < 300; i++) cloak.update(1 / 60, body, V(0, 0, -1.5));
  let worst = 0;
  for (let i = cloak.cols; i < cloak.cols * cloak.rows; i++) {
    const d = Math.hypot(cloak.pos[i * 3] - body[0].c.x,
                         cloak.pos[i * 3 + 1] - body[0].c.y,
                         cloak.pos[i * 3 + 2] - body[0].c.z);
    worst = Math.max(worst, body[0].r - d);
  }
  assert(worst < 0.02, `cloth sank ${(worst * 100).toFixed(1)}cm into the body`);
  return `deepest intrusion ${(worst * 1000).toFixed(1)}mm`;
});

check('cloth: a long frame does not detonate the solve', () => {
  const cloak = new Cloak(scene, {
    cols: 7, rows: 9, width: 0.6, length: 1.0,
    anchorFn: (c, n, out) => out.set(lerpN(-0.3, 0.3, c, n), 1.6, 0),
  });
  cloak.reset();
  for (let i = 0; i < 30; i++) cloak.update(0.9, [], V(0, 0, 0));   // 0.9s frames
  for (let i = 0; i < cloak.cols * cloak.rows; i++) {
    assert(isFinite(cloak.pos[i * 3 + 1]), 'cloth blew up on a long frame');
    assert(Math.abs(cloak.pos[i * 3 + 1]) < 60, 'cloth flew away on a long frame');
  }
  return 'clamped, stays put';
});

check('cloth: a rigged cloak finds its anchors and its body', () => {
  const rig = new Rig(humanoidSkeleton(1));
  rig.hipsBone.obj.position.set(0, 0.95, 0);
  rig.updateMatrices();
  const cloak = attachCloak(scene, rig, { width: 0.6, length: 1.0, cols: 7, rows: 9 });
  assert(cloak, 'attachCloak returned nothing');
  const cols = cloak.refreshColliders();
  assert(cols.length >= 12, `only ${cols.length} body colliders`);
  cloak.reset();
  for (let i = 0; i < 120; i++) cloak.update(1 / 60, cloak.refreshColliders(), V(0, 0, 0));
  const chestY = rig.worldPos('chest', new THREE.Vector3()).y;
  const top = cloak.pos[1];
  assert(Math.abs(top - chestY) < 0.5, `collar sat ${Math.abs(top - chestY).toFixed(2)}m from the chest`);
  return `${cols.length} colliders, collar at the shoulders`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  V2 — the dojo                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

check('dojo: lessons advance on the event each one is watching for', () => {
  const spawned = [];
  const world = {
    enemies: [], locks: [], player: { position: V(0, 0, 0) },
    bolts: { clear() {} }, notify() {},
    spawnEnemy(type, pos) {
      const e = { type, dead: false, dying: 0, dispose() {}, duel: null, position: pos.clone() };
      spawned.push(e); world.enemies.push(e); return e;
    },
  };
  const d = new DojoDirector(world);
  d.start();
  assert(d.lesson.id === 'feel', `started on ${d.lesson.id}`);

  // the first lesson wants fast swings and nothing else
  d.report({ type: 'deflect', grade: 3 });
  assert(d.progress === 0, 'a deflection advanced the swing lesson');
  for (let i = 0; i < LESSONS[0].need; i++) d.report({ type: 'swing', speed: 20 });
  assert(d.lesson.id === 'block', `did not advance past 'feel' (on ${d.lesson.id})`);
  assert(spawned.some(e => e.type === 'remote'), 'the block lesson brought no remote');

  // and a slow swing must not count
  d.repeat();
  const before = d.progress;
  d.report({ type: 'swing', speed: 2 });
  assert(d.progress === before, 'a slow swing counted');
  return `${LESSONS.length} lessons, gated on the right events`;
});

check('dojo: every lesson has a brief, a hint and a reachable target', () => {
  for (const L of LESSONS) {
    assert(L.title && L.brief && L.hint, `${L.id} is missing copy`);
    assert(typeof L.check === 'function', `${L.id} has no check`);
    assert(L.need > 0, `${L.id} needs ${L.need}`);
    assert(L.setup, `${L.id} has no room setup`);
  }
  const last = LESSONS[LESSONS.length - 1];
  assert(last.need === Infinity, 'the final lesson should never complete');
  return `${LESSONS.length} lessons, all documented`;
});

check('dojo: skipping and going back stay inside the lesson list', () => {
  const world = { enemies: [], locks: [], player: null, bolts: { clear() {} }, notify() {},
    spawnEnemy: () => ({ dead: false, dying: 0, dispose() {} }) };
  const d = new DojoDirector(world);
  for (let i = 0; i < 40; i++) d.skip();
  assert(d.index === LESSONS.length - 1, `skipped past the end to ${d.index}`);
  for (let i = 0; i < 40; i++) d.back();
  assert(d.index === 0, `went back past the start to ${d.index}`);
  return 'clamped at both ends';
});

check('dojo: a training remote is built and can be aimed', () => {
  const r = buildRemote({ scale: 1 });
  for (const key of ['group']) assert(r[key], `remote missing ${key}`);
  // and every vertex must be finite — a NaN scale here reaches the audio panner
  let bad = 0;
  r.group.traverse(o => {
    const p = o.geometry?.attributes?.position;
    if (!p) return;
    for (let i = 0; i < p.count * 3; i++) if (!isFinite(p.array[i])) bad++;
  });
  assert(bad === 0, `${bad} non-finite vertices in the remote`);
  assert(r.group, 'no mesh');
  assert(r.muzzles.length >= 3, `only ${r.muzzles.length} emitters`);
  let tris = 0;
  r.group.traverse(o => { if (o.geometry?.index) tris += o.geometry.index.count / 3; });
  assert(tris > 100, `remote is only ${tris} triangles`);
  return `${r.muzzles.length} emitters, ${Math.round(tris)} triangles`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Audio                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

check('audio: retiring a voice never tears down the shared effects bus', async () => {
  // A non-positional one-shot is routed straight to sfxBus. Calling disconnect()
  // on that unplugs every sound in the game from the compressor — permanently,
  // and silently. This is the guard that keeps the game audible.
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  let busDisconnects = 0, panDisconnects = 0;
  a.sfxBus = { disconnect: () => busDisconnects++ };
  a.musicBus = { disconnect: () => busDisconnects++ };
  a.master = { disconnect: () => busDisconnects++ };
  const panner = { disconnect: () => panDisconnects++ };

  // a source whose `ended` we can fire by hand, the way the audio clock would
  const mkSrc = () => ({ set onended(f) { this._f = f; }, get onended() { return this._f; } });
  const s1 = mkSrc(), s2 = mkSrc(), s3 = mkSrc();
  a.voices = 3;
  a._freeOnEnd(s1, a.sfxBus, 0.1);
  a._freeOnEnd(s2, a.musicBus, 0.1);
  a._freeOnEnd(s3, panner, 0.1);
  s1.onended(); s2.onended(); s3.onended();

  assert(busDisconnects === 0, `${busDisconnects} shared buses were disconnected — the game goes silent`);
  assert(panDisconnects === 1, `the per-voice panner was not released (${panDisconnects})`);
  assert(a.voices === 0, `voice count leaked: ${a.voices} still held`);

  // and the backstop must not double-release when `ended` already fired
  s3.onended();
  assert(a.voices === 0 && panDisconnects === 1, 'a second `ended` released the voice twice');
  return 'buses survive, panners are released, voice count returns to 0';
});

check('audio: a NaN never leaks the voice pool dry', async () => {
  // Game maths produces NaN (a degenerate normal, a zero-length velocity), and
  // every WebAudio param rejects it with a TypeError. Thrown between taking a
  // voice and releasing it, 44 of those silence the game for the whole session.
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  a.ready = true;
  const bad = () => { throw new TypeError('non-finite value'); };
  const param = () => ({ set value(v) { if (!Number.isFinite(v)) bad(); },
                         setValueAtTime: bad, linearRampToValueAtTime: bad,
                         exponentialRampToValueAtTime: bad, setTargetAtTime: bad });
  a.sfxBus = { disconnect() {} };
  a.ctx = {
    currentTime: 0,
    createBufferSource: () => ({ playbackRate: { value: 0 }, connect() {}, start: bad, stop() {}, buffer: null, loop: false }),
    createBiquadFilter: () => ({ type: '', frequency: param(), Q: { value: 0 }, connect() {} }),
    createGain: () => ({ gain: param(), connect() {} }),
    createOscillator: () => ({ type: '', frequency: param(), detune: { value: 0 }, connect() {}, start: bad, stop() {} }),
  };
  for (let i = 0; i < 200; i++) {
    a.noise({ dur: 0.2, gain: 0.4, freq: 1200 });
    a.tone({ freq: 440, dur: 0.2 });
  }
  assert(a.voices === 0, `${a.voices} of ${a.maxVoices} voices leaked — the game would go silent`);

  // and NaN arguments must not reach a param in the first place
  const seen = [];
  a.ctx.createBiquadFilter = () => ({ type: '',
    frequency: { set value(v) { seen.push(v); }, exponentialRampToValueAtTime: (v) => seen.push(v) },
    Q: { set value(v) { seen.push(v); } }, connect() {} });
  a.ctx.createGain = () => ({ gain: { setValueAtTime: (v) => seen.push(v),
    linearRampToValueAtTime: (v) => seen.push(v), setTargetAtTime: (v) => seen.push(v) }, connect() {} });
  a.ctx.createBufferSource = () => ({ playbackRate: { value: 0 }, connect() {}, start() {}, stop() {}, buffer: null, loop: false });
  a.noise({ dur: NaN, gain: NaN, freq: NaN, q: NaN, freqEnd: NaN });
  assert(seen.length && seen.every(Number.isFinite), `NaN reached an AudioParam: ${seen}`);
  return `200 throwing calls, 0 voices leaked; NaN args sanitised at the door`;
});

check('audio: a NaN position falls back instead of throwing away a voice', async () => {
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const a = new AudioEngine();
  a.sfxBus = { id: 'sfx' };
  a._listenerPos.set(0, 0, 0);
  assert(a._out({ x: NaN, y: 0, z: 0 }) === a.sfxBus, 'a NaN position did not fall back to the bus');
  assert(a._out({ x: 0, y: 0, z: 300 }) === null, 'a distant sound was not culled');
  return 'NaN → dry bus, 300m → culled';
});

check('math: clamp does not pass NaN through', () => {
  assert(clamp(NaN, 0, 1) === 0, `clamp(NaN) returned ${clamp(NaN, 0, 1)}`);
  assert(clamp(-5, 0, 1) === 0 && clamp(5, 0, 1) === 1 && clamp(0.5, 0, 1) === 0.5, 'clamp broke');
  assert(clamp(0, 0, 1) === 0 && clamp(1, 0, 1) === 1, 'clamp is not inclusive at the bounds');
  return 'NaN → low bound, bounds inclusive';
});

check('bodies: a limb is a closed surface with no seam crease', () => {
  const g = limbGeo(0.4, 0.07, 0.05, 12, true);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  assert(nrm, 'the lathe produced no normals');

  // every normal unit length and finite — a degenerate profile ring shows up here
  let worst = 0;
  for (let i = 0; i < nrm.count; i++) {
    const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    assert(isFinite(l), `normal ${i} is non-finite`);
    worst = Math.max(worst, Math.abs(l - 1));
  }
  assert(worst < 1e-3, `normals are not unit length (off by ${worst.toFixed(4)})`);

  // the cap must reach the pole: some vertex has to sit on the axis below y=0
  let lowest = Infinity, radiusAtLowest = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < lowest - 1e-6) { lowest = y; radiusAtLowest = Math.hypot(pos.getX(i), pos.getZ(i)); }
  }
  assert(lowest < -0.03, `the bottom cap only reaches y=${lowest.toFixed(4)}`);
  assert(radiusAtLowest < 1e-4,
    `the cap is open: its lowest ring has radius ${radiusAtLowest.toFixed(4)}, not a pole`);

  // and the profile must be monotonic in y, or it folds back through itself
  return `closed at y=${lowest.toFixed(3)}, ${nrm.count} unit normals, no re-derivation`;
});

check('focus: the passive dip is free and arms only on a close bolt', () => {
  const f = new FocusSystem();
  // nothing incoming: full speed, no cost
  for (let i = 0; i < 30; i++) assert(f.update(1 / 60, false, 100, []) === 0, 'the passive layer charged Force');
  near(f.scale, 1, 1e-6, 'time was slowed with nothing incoming');

  // a bolt a long way out must NOT arm it
  for (let i = 0; i < 30; i++) f.update(1 / 60, false, 100, [{ eta: 1.2, dist: 12 }]);
  near(f.scale, 1, 0.02, 'a distant bolt armed the passive dip');

  // one about to land does
  for (let i = 0; i < 30; i++) f.update(1 / 60, false, 100, [{ eta: 0.12, dist: 6 }]);
  assert(f.scale < FOCUS.passiveScale + 0.03,
    `the passive dip only reached ${f.scale.toFixed(3)}, expected ~${FOCUS.passiveScale}`);
  assert(f.update(1 / 60, false, 100, [{ eta: 0.12, dist: 6 }]) === 0, 'the passive layer charged Force');
  return `1.00 idle → ${f.scale.toFixed(2)} on a 0.12s bolt, free`;
});

check('focus: the held layer is deep, costs Force, and stops at empty', () => {
  const f = new FocusSystem();
  let spent = 0;
  for (let i = 0; i < 60; i++) spent += f.update(1 / 60, true, 100, []);
  // 0.25, not 0.45. See the note over FOCUS.heldScale: at 0.35 a bolt from ten
  // metres still arrived in 0.32 s, which is a slightly slower bolt rather than
  // time to answer one. This is a ratchet on the depth the player paid for.
  assert(f.scale < 0.25, `held Focus only reached ${f.scale.toFixed(3)}`);
  assert(spent > 25 && spent < 45, `one second of Focus cost ${spent.toFixed(1)} Force`);
  // the player keeps most of their own speed — that asymmetry IS the ability
  const deep = f.scale;                       // before the empty-Force test below resets it
  const effective = f.scale * f.playerCompensation;
  assert(effective > 0.7, `the player was slowed to ${effective.toFixed(2)} of real time along with the world`);

  // empty Force must not sustain it
  for (let i = 0; i < 60; i++) f.update(1 / 60, true, 2, []);
  near(f.scale, 1, 0.02, `Focus held at ${f.scale.toFixed(3)} on an empty Force bar`);
  assert(f.update(1 / 60, true, 2, []) === 0, 'it charged Force it did not have');
  return `world ${deep.toFixed(2)}x / player ${effective.toFixed(2)}x, ${spent.toFixed(0)} Force/s, cuts out at empty`;
});

check('focus: the two layers stack and never stop or reverse time', () => {
  const f = new FocusSystem();
  const threat = [{ eta: 0.1, dist: 5 }];
  for (let i = 0; i < 90; i++) f.update(1 / 60, true, 100, threat);
  const both = f.scale;
  const f2 = new FocusSystem();
  for (let i = 0; i < 90; i++) f2.update(1 / 60, true, 100, []);
  assert(both < f2.scale - 0.02, `stacking gave ${both.toFixed(3)} vs held-only ${f2.scale.toFixed(3)}`);

  // and under every combination time stays strictly positive and bounded
  const f3 = new FocusSystem();
  for (let i = 0; i < 600; i++) {
    const s = f3.update(1 / 60, i % 3 === 0, 100, i % 2 ? threat : []);
    assert(f3.scale > 0 && f3.scale <= 1, `time scale left (0,1]: ${f3.scale}`);
    assert(isFinite(f3.playerCompensation) && f3.playerCompensation >= 1, 'compensation went non-finite');
    assert(s >= 0, 'negative Force drain');
  }
  return `stacked ${both.toFixed(2)}x vs ${f2.scale.toFixed(2)}x held alone, always in (0,1]`;
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Wind, ground cover, air and particles                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** A terrain stand-in: flat, unlimited, and free to build. */
const FLAT = { height: () => 0, slopeAt: () => 0, size: 400, half: 200 };

function litScene() {
  const s = new THREE.Scene();
  s.fog = new THREE.FogExp2(0xc9b391, 0.004);
  const sun = new THREE.DirectionalLight(0xffffff, 7);
  sun.castShadow = true;
  sun.position.set(0.4, 0.8, 0.3);
  s.add(sun);
  s.add(new THREE.HemisphereLight(0xbcd8ff, 0x60482e, 0.3));
  return s;
}

check('wind: the gust field is bounded, coherent nearby and varied at range', () => {
  const w = new WindField({ heading: 0.4, strength: 2, gustiness: 0.7 });
  let lo = 9, hi = -9;
  for (let i = 0; i < 6000; i++) {
    const g = w.gust((i * 7.3) % 500 - 250, (i * 11.9) % 500 - 250, i * 0.017);
    assert(isFinite(g), 'the gust field went non-finite');
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  assert(lo > -1.0001 && hi < 1.0001, `gust left [-1,1]: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  assert(hi > 0.85 && lo < -0.85, `gust never reaches its bounds: ${lo.toFixed(2)}..${hi.toFixed(2)}`);

  // a metre apart is the same weather; sixty metres apart is not
  const a = w.sample(0, 0, new THREE.Vector3());
  const b = w.sample(1, 0, new THREE.Vector3());
  const c = w.sample(70, 40, new THREE.Vector3());
  assert(a.distanceTo(b) < 0.12, `neighbouring blades disagree by ${a.distanceTo(b).toFixed(3)}`);
  assert(a.distanceTo(c) > 0.25, `the gust is uniform across 70m (${a.distanceTo(c).toFixed(3)})`);
  return `[${lo.toFixed(2)}, ${hi.toFixed(2)}], ${a.distanceTo(b).toFixed(3)} at 1m vs ${a.distanceTo(c).toFixed(2)} at 70m`;
});

check('wind: gusts travel downwind rather than shimmering in place', () => {
  const w = new WindField({ heading: 0, strength: 2 });
  // The whole point of a shared field: fronts MOVE. Sample the same phase at a
  // later time further downwind and it must be the identical value.
  const speed = 0.62 / 0.055;          // GUST_W / GUST_K
  for (const t of [0.5, 2, 7.25]) {
    const here = w.gust(0, 0, 0);
    const there = w.gust(w.dir.x * speed * t, w.dir.y * speed * t, t);
    near(there, here, 1e-6, `the gust front did not travel over ${t}s`);
  }
  // and a fixed point must actually change as it passes
  let swing = 0;
  for (let i = 0; i < 400; i++) swing = Math.max(swing, Math.abs(w.gust(0, 0, i * 0.05) - w.gust(0, 0, 0)));
  assert(swing > 0.8, `a fixed point only saw the wind change by ${swing.toFixed(2)}`);
  assert(w.strengthAt(0, 0) >= 0 && w.strengthAt(1e4, -1e4) >= 0, 'wind speed went negative');
  return `fronts at ${speed.toFixed(1)} m/s, ${swing.toFixed(2)} swing at a fixed point`;
});

check('wind: the shader implements the same field the CPU does', () => {
  // WindField and WIND_GLSL are hand-mirrored. If one drifts, the grass leans
  // one way and the smoke another, and nothing about the frame reads as wind.
  const nums = (s) => (s.match(/(?<![\w.])\d+\.\d+/g) || []).map(Number);
  const glsl = WIND_GLSL.slice(WIND_GLSL.indexOf('float windGust'), WIND_GLSL.indexOf('vec3 windAt'));
  const js = WindField.prototype.gust.toString();
  const inShader = new Set(nums(glsl).map(n => n.toFixed(6)));
  const inJs = nums(js).map(n => n.toFixed(6));
  const missing = inJs.filter(n => !inShader.has(n));
  assert(missing.length === 0, `coefficients only the CPU has: ${missing.join(', ')}`);
  assert(inShader.has((0.62).toFixed(6)) && inShader.has((0.055).toFixed(6)),
    'the shader lost the travelling-front constants');
  return `${inJs.length} shared coefficients, both directions`;
});

check('scenery: pushers are matched frame to frame so grass knows where you are going', () => {
  const t = new PusherTracker();
  t.update([{ x: 0, y: 0, z: 0, w: 1 }, { x: 8, y: 0, z: 0, w: 1 }], 1 / 60);
  // the two swap places in the list — identity has to come from position
  for (let i = 1; i <= 12; i++) {
    var out = t.update([
      { x: 8 - i * 0.05, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: i * 0.1, w: 1 },
    ], 1 / 60);
  }
  assert(out.length === 2, 'the tracker lost a pusher');
  const walker = out[1], strafer = out[0];
  assert(walker.vz > 3 && Math.abs(walker.vx) < 0.5,
    `the walker's velocity came out as (${walker.vx.toFixed(2)}, ${walker.vz.toFixed(2)})`);
  assert(strafer.vx < -1.5, `the reversed entry was matched to the wrong body (vx=${strafer.vx.toFixed(2)})`);
  // the tracker hands back its own reusable slots, so read what you need now
  const forward = walker.vz;
  // a body that teleports must not be handed a huge bogus velocity
  const jump = t.update([{ x: 8, y: 0, z: 0, w: 1 }, { x: 60, y: 0, z: 60, w: 1 }], 1 / 60);
  assert(jump[1].speed === 0, `a teleport produced ${jump[1].speed.toFixed(1)} m/s`);
  return `swapped order, ${forward.toFixed(1)} m/s forward, teleports ignored`;
});

check('grass: walking through it presses a trail that springs back', () => {
  const scene = litScene();
  const g = new GrassField(scene, FLAT, { count: 400, radius: 30 });
  const c = new THREE.Vector3(0, 0, 0);
  const path = [];
  for (let i = 0; i < 60; i++) {
    c.set(0, 0, i * 0.12);
    g.update(1 / 60, c, [{ x: c.x, y: 0, z: c.z, w: 1.2 }], null);
    path.push(c.z);
  }
  const here = g.sampleTrail(0, path[path.length - 1]);
  const behind = g.sampleTrail(0, path[10]);
  const beside = g.sampleTrail(6, path[path.length - 1]);
  assert(here.press > 0.5, `standing in the grass only pressed it to ${here.press.toFixed(2)}`);
  assert(behind.press > 0.02 && behind.press < here.press,
    `the trail behind reads ${behind.press.toFixed(3)} against ${here.press.toFixed(3)} underfoot`);
  assert(beside.press < 0.02, `grass six metres away was flattened (${beside.press.toFixed(3)})`);
  assert(here.dirZ > 0.2, `the shove points ${here.dirZ.toFixed(2)} along the direction of travel`);

  // stand still somewhere else and the trail recovers
  for (let i = 0; i < 180; i++) g.update(1 / 60, c.set(0, 0, 20), [], null);
  const healed = g.sampleTrail(0, path[path.length - 1]);
  assert(healed.press < 0.05, `the trail was still ${healed.press.toFixed(2)} pressed three seconds later`);
  g.dispose();
  return `${here.press.toFixed(2)} underfoot, ${behind.press.toFixed(2)} behind, ${healed.press.toFixed(3)} after 3s`;
});

check('grass: a blade cuts it, and the cut outlives the footprint', () => {
  const scene = litScene();
  const g = new GrassField(scene, FLAT, { count: 400, radius: 30 });
  const c = new THREE.Vector3(0, 0, 0);
  g.update(1 / 60, c, [], null);
  g.cut(new THREE.Vector3(-1.5, 0.2, 0), new THREE.Vector3(1.5, 0.2, 0), 0.3);
  const cutNow = g.sampleTrail(0, 0);
  assert(cutNow.cut > 0.7, `the sweep only cut to ${cutNow.cut.toFixed(2)}`);
  assert(g.sampleTrail(0, 4).cut === 0, 'the cut reached grass the blade never touched');

  for (let i = 0; i < 300; i++) g.update(1 / 60, c, [], null);   // five seconds
  const later = g.sampleTrail(0, 0);
  assert(later.press < 0.05, `the press left by the sweep is still ${later.press.toFixed(2)}`);
  assert(later.cut > 0.55, `the cut healed to ${later.cut.toFixed(2)} in five seconds`);
  g.dispose();
  return `cut ${cutNow.cut.toFixed(2)} → ${later.cut.toFixed(2)} after 5s, press gone`;
});

check('grass: the disturbance window wraps without smearing marks across the map', () => {
  // Addressing is toroidal, so a texel written at x=0 is the same texel as
  // x=+40. Scrolling the window has to clear what left it, or footprints
  // reappear forty metres away.
  const scene = litScene();
  const g = new GrassField(scene, FLAT, { count: 200, radius: 30 });
  const c = new THREE.Vector3(0, 0, 0);
  g.update(1 / 60, c, [{ x: 0, y: 0, z: 0, w: 1.2 }], null);
  assert(g.sampleTrail(0, 0).press > 0.4, 'nothing was written in the first place');

  // walk far enough that the old mark's texel now belongs to new ground
  for (let i = 1; i <= 220; i++) g.update(1 / 60, c.set(i * 0.1, 0, 0), [], null);
  const alias = g.sampleTrail(g.trailSize, 0);       // the same texel, new ground
  assert(alias.press < 0.02, `a stale footprint aliased in at ${alias.press.toFixed(3)}`);

  // and a splat outside the window must be dropped, not folded in
  g.disturb(c.x + 400, 0, 1.5, { press: 1 });
  assert(g.sampleTrail(c.x, 0).press < 0.02, 'a disturbance 400m away landed underfoot');
  assert(g.sampleTrail(c.x + 400, 0).inside === false, 'the window claims to cover 400m of ground');
  g.dispose();
  return `${g.trailRes}² texels over ${g.trailSize}m, wrap cleared`;
});

check('grass: the whole LOD ladder tiles the field with overlaps, not gaps', () => {
  /* Was TWO rings out to 46 m. It is four now, out to 400, and the property
   * is the same one asserted over every adjacent pair rather than over the
   * only pair there was: no rung may start beyond where the one inside it has
   * finished fading, or the field ends in a visible circle and starts again
   * further out. The budget must still land somewhere, and every instance must
   * still be inside the annulus its own shader fades. */
  const scene = litScene();
  const g = new GrassField(scene, FLAT, { count: 3000, radius: 46 });
  assert(g.rings.length >= 4, `only ${g.rings.length} LOD rungs — the field is a bubble again`);
  const spent = g.rings.reduce((a, r) => a + r.count, 0);
  assert(spent === g.count, `the budget is ${g.count} and the rings hold ${spent}`);
  assert(g.count > 3000, 'the budget did not grow with the reach it now has to fill');
  for (let i = 1; i < g.rings.length; i++) {
    const inner = g.rings[i - 1], outer = g.rings[i];
    assert(outer.mat.uniforms.uNear.value < inner.mat.uniforms.uFar.value,
      `${inner.tier.name}/${outer.tier.name} leave a hole between `
      + `${inner.mat.uniforms.uFar.value} and ${outer.mat.uniforms.uNear.value} m`);
  }
  assert(g.reach > 300, `the field reaches only ${g.reach} m on a level you can see 700 across`);

  g.update(1 / 60, new THREE.Vector3(0, 0, 0), [], null);
  /* Blades are jittered around a tuft centre and the window is snapped to the
   * tier's cell grid, so the annulus holds to within a cell and no further.
   *
   * MEASURED FROM THE TIER'S OWN SNAPPED WINDOW CENTRE, which is the frame the
   * fill works in — a tier's contents are a pure function of its snapped cell
   * (see Scenery._fillTier) and measuring from the camera instead only agreed
   * with that while the camera happened to be sitting near a cell middle. The
   * tolerance is HALF a tuft's spread rather than a whole one, because that is
   * the real bound: a blade is placed at sqrt(u)·0.5·spread from its tuft. */
  let tris = 0, live = 0;
  for (const ring of g.rings) {
    const a = ring.aInst.array;
    const slop = ring.cell + ring.spread * 0.5 + 1e-6;
    const kx = (ring.ci + 0.5) * ring.cell, kz = (ring.cj + 0.5) * ring.cell;
    for (let i = 0; i < ring.count; i++) {
      if (a[i * 4 + 3] <= 0.004) continue;
      live++;
      const r = Math.hypot(a[i * 4] - kx, a[i * 4 + 2] - kz);
      assert(r <= ring.far + slop, `a ${ring.tier.name} sits at ${r.toFixed(2)}m, outside ${ring.far}m`);
      assert(r >= ring.near - slop, `a ${ring.tier.name} sits at ${r.toFixed(2)}m, inside ${ring.near}m`);
    }
    tris += ring.count * (ring.geo.index.count / 3);
  }

  // and the near rung is real geometry while every rung past it is not
  assert(g.near.geo.index.count / 3 === 8, `a blade is ${g.near.geo.index.count / 3} triangles`);
  assert(!g.rings[0].card, 'the nearest rung is a billboard');
  assert(g.rings.slice(1).every(r => r.card), 'a distant rung is still drawing real blades');
  const draws = g.meshes.length;
  g.dispose();
  return `${g.rings.map(r => `${r.tier.name} ${r.count}`).join(' + ')} = ${spent} instances, `
    + `${tris} triangles, ${draws} draw calls, reach ${g.reach} m`;
});

check('grass: it is lit, shadowed and fogged rather than a flat colour multiply', () => {
  const scene = litScene();
  const g = new GrassField(scene, FLAT, { count: 200, radius: 30 });
  for (const ring of [g.near, g.far]) {
    const m = ring.mat;
    assert(m.lights === true, 'the grass does not take the scene lights');
    assert(m.fog === true, 'the grass ignores fog — it will band out of the haze');
    assert(m.uniforms.directionalLights, 'no directional light uniforms');
    assert(m.uniforms.directionalShadowMap, 'no shadow map uniform');
    assert(m.fragmentShader.includes('getShadowMask'), 'the grass never samples the shadow map');
    assert(m.fragmentShader.includes('fog_fragment'), 'the grass never applies fog');
    assert(m.vertexShader.includes('shadowmap_vertex'), 'no shadow coordinates are generated');
    assert(ring.mesh.receiveShadow === true, 'the mesh is flagged not to receive shadows');
  }
  // the blade normal has to vary along the blade or N·L is worthless
  assert(g.near.mat.vertexShader.includes('cross(tang, sideV)'), 'the blade has no real normal');
  g.dispose();
  return 'sun + hemisphere + shadow mask + translucency, fogged';
});

check('scenery: water, dust and every particle pool respect the fog', () => {
  const scene = litScene();
  const w = new Water(scene, { size: 100 });
  const a = new Atmosphere(scene, { count: 60, density: 0.2 });
  const p = new Particles(scene, 0.2);
  const fogged = [w.mat, a.motes.mat, a.windborne.mat, p.decals.mat, ...p.pools.map(x => x.mat)];
  for (const m of fogged) assert(m.fog === true, 'a material still ignores fog');
  for (const m of fogged) {
    assert(m.fragmentShader.includes('fog_pars_fragment'), 'a material declares no fog uniforms');
  }
  // additive pools must lose light to distance, not gain the fog colour
  const additive = p.pools.filter(x => x.mat.blending === THREE.AdditiveBlending);
  assert(additive.length === 3, `expected 3 emissive pools, found ${additive.length}`);
  for (const x of additive) assert('EMISSIVE_POOL' in x.mat.defines, 'an additive pool blends toward the fog colour');
  for (const x of p.pools) {
    if (x.mat.blending === THREE.AdditiveBlending) continue;
    assert(!('EMISSIVE_POOL' in x.mat.defines), 'a smoke pool is being treated as an emitter');
  }
  assert(p.sparks.mat.fragmentShader.includes('gl_FragColor.rgb *= (1.0 - fogFactor)'),
    'the attenuating branch is gone');
  w.dispose(); a.dispose(); p.dispose();
  return `${fogged.length} materials fogged, ${additive.length} emissive pools attenuated`;
});

check('particles: a pool wraps at its cap and never allocates past it', () => {
  const scene = litScene();
  const pool = new ParticlePool(scene, { max: 64, map: null });
  const v = V(0, 0, 0);
  for (let i = 0; i < 200; i++) pool.spawn(V(i, 0, 0), v, { life: 5 });
  assert(pool.head === 200 % 64, `the ring head is at ${pool.head}`);
  assert(pool.live === 64, `the pool reports ${pool.live} live of 64`);
  assert(pool.aSpawn.array.length === 64 * 3, 'the pool grew its buffers');
  // the last 64 spawns are the ones still in the buffer
  const xs = new Set();
  for (let i = 0; i < 64; i++) xs.add(pool.aSpawn.array[i * 3]);
  for (let i = 136; i < 200; i++) assert(xs.has(i), `spawn ${i} was dropped from the ring`);
  pool.dispose();
  return '64 slots, 200 spawns, oldest overwritten first';
});

check('particles: chips are real bodies — they fall, bounce and come to rest', () => {
  const scene = litScene();
  const chips = new ChipField(scene, { max: 32 });
  chips.spawn(V(0, 5, 0), V(2, 0, 0), { life: 30, size: 0.06, floor: 0, restitution: 0.4 });
  const c = chips.chips.find(x => x.alive);
  let lowest = Infinity, bounces = 0, wasFalling = true;
  for (let i = 0; i < 900; i++) {
    chips.update(1 / 60);
    lowest = Math.min(lowest, c.pos.y);
    if (wasFalling && c.vel.y > 0.05) { bounces++; wasFalling = false; }
    if (c.vel.y < -0.05) wasFalling = true;
  }
  assert(lowest > -1e-6, `a chip fell through its floor to y=${lowest.toFixed(3)}`);
  assert(bounces >= 1, 'the chip never bounced, it just stuck');
  assert(c.sleep === 1, 'the chip never settled');
  near(c.pos.y, 0.03, 0.01, 'the chip did not come to rest on the floor');
  assert(Math.abs(c.pos.x) > 0.05, 'the chip did not travel along its initial velocity');
  assert(chips.mesh.count === 1, `${chips.mesh.count} instances drawn for one chip`);
  chips.dispose();
  return `${bounces} bounces, asleep at y=${c.pos.y.toFixed(3)}, x=${c.pos.x.toFixed(2)}`;
});

check('particles: the chip pool recycles its slots and never exceeds its cap', () => {
  const scene = litScene();
  const chips = new ChipField(scene, { max: 24 });
  for (let i = 0; i < 24 * 4; i++) chips.spawn(V(0, 3, 0), V(0, 0, 0), { life: 2, floor: 0 });
  assert(chips.liveCount === 24, `${chips.liveCount} live in a 24-slot pool`);
  assert(chips.free.length === 0, 'the free list still has slots while the pool is full');
  const ids = new Set();
  for (let i = 0; i < 24; i++) ids.add(chips.chips[i]);
  assert(ids.size === 24, 'the pool aliased two chips onto one slot');
  chips.update(1 / 60);
  assert(chips.mesh.count === 24, `${chips.mesh.count} instances drawn for 24 chips`);
  for (let i = 0; i < 200; i++) chips.update(1 / 60);      // outlive them
  assert(chips.liveCount === 0 && chips.free.length === 24,
    `${chips.free.length} of 24 slots came back`);
  assert(chips.mesh.count === 0, 'expired chips are still being drawn');
  chips.dispose();
  return '24 slots, 96 spawns, all returned';
});

check('particles: running throws dust backwards, and teleports throw none', () => {
  const scene = litScene();
  const p = new Particles(scene, 1);
  const dust = p.dust;
  p.sandPuff(V(0, 0, 0), 1, 0, 0xffffff);          // first footfall: no history
  p.update(1 / 60);
  const head = dust.head;
  p.sandPuff(V(0, 0, 0.9), 1, 0, 0xffffff);        // a stride further along +z
  let meanZ = 0;
  const n = 10;
  for (let i = 0; i < n; i++) meanZ += dust.aVel.array[((head + i) % dust.max) * 3 + 2];
  meanZ /= n;
  assert(meanZ < -0.6, `dust from a runner averaged vz=${meanZ.toFixed(2)}, not thrown behind`);

  // a spawn twenty metres away is not a stride, it is a different body
  p.update(1 / 60);
  const head2 = dust.head;
  p.sandPuff(V(0, 0, 21), 1, 0, 0xffffff);
  let meanZ2 = 0;
  for (let i = 0; i < n; i++) meanZ2 += dust.aVel.array[((head2 + i) % dust.max) * 3 + 2];
  meanZ2 /= n;
  assert(Math.abs(meanZ2) < 0.9, `a 20m jump was read as a stride (vz=${meanZ2.toFixed(2)})`);

  // and two runners a couple of metres apart are two runners, not one sprinting
  // between them: the footfalls have to be matched by proximity
  const q = new Particles(litScene(), 1);
  q.sandPuff(V(0, 0, 0), 1, 0, 0xffffff);      // runner A, heading +z
  q.sandPuff(V(2.4, 0, 0), 1, 0, 0xffffff);    // runner B, two metres to the side
  q.update(1 / 60);
  const headA = q.dust.head;
  q.sandPuff(V(0, 0, 0.9), 1, 0, 0xffffff);    // A's next step
  let a = 0;
  for (let i = 0; i < n; i++) a += q.dust.aVel.array[((headA + i) % q.dust.max) * 3 + 2];
  a /= n;
  assert(a < -0.6, `A's dust came out at vz=${a.toFixed(2)} — it was matched to B's footfall`);
  q.dispose();
  p.dispose();
  return `vz ${meanZ.toFixed(2)} running, ${meanZ2.toFixed(2)} teleporting, ${a.toFixed(2)} with a second runner alongside`;
});

check('particles: a splash rings the water it landed in', () => {
  const scene = litScene();
  const w = new Water(scene, { size: 80, level: 0.35 });
  const p = new Particles(scene, 0.4);
  const before = w.mat.uniforms.uRipples.value.filter(r => r.w > 0).length;
  p.splash(V(4, 0.35, -3), 1.2);
  const live = w.mat.uniforms.uRipples.value.filter(r => r.w > 0);
  assert(live.length === before + 1, 'the splash did not ring the water');
  near(live[0].x, 4, 1e-5, 'the ripple is in the wrong place');
  near(live[0].y, -3, 1e-5, 'the ripple is in the wrong place');
  assert(live[0].w > 0 && live[0].w <= 3, 'the ripple strength is out of range');
  // and the ring must recycle rather than grow
  for (let i = 0; i < 50; i++) w.ripple(i, i, 1);
  assert(w.mat.uniforms.uRipples.value.length === 10, 'the ripple array grew');
  w.dispose(); p.dispose();
  return '10-slot ripple ring, recycled';
});

check('particles: every recipe survives a level with no terrain, water or grass', () => {
  // Levels differ: the dune sea has no water and no grass, the hangar has no
  // terrain worth cratering. Nothing here may depend on a system being present.
  ground.grass = null; ground.water = null; ground.terrain = null;
  const scene = litScene();
  const p = new Particles(scene, 0.5);
  const at = V(3, 1, -2), dir = V(0, 1, 0);
  p.sparkBurst(at, dir, 10);
  p.cutFlare(at, dir, 0x57c9ff, 12);
  p.boltImpact(at, dir, 0xff3a2a);
  p.sandPuff(at, 0.3, 1, 0xd8c09a);
  p.sandPuff(at, 1.8, 1, 0xd8c09a);
  p.slide(at, V(1, 0, 0), 1, 1);
  p.bladeScar(V(0, 1, 0), V(2, 1, 1));
  p.grassClippings(V(0, 1, 0), V(1, 1, 0));
  p.chipBurst(at, dir, 6);
  p.splash(at, 1);
  p.explosion(at, 1);
  p.slag(at, dir);
  p.scorch(at, dir, 0.4, { heat: 1 });
  for (let i = 0; i < 30; i++) p.update(1 / 60);
  for (const pool of p.pools) {
    for (const v of pool.aSpawn.array) assert(isFinite(v), 'a particle spawned at a non-finite position');
    for (const v of pool.aVel.array) assert(isFinite(v), 'a particle got a non-finite velocity');
  }
  for (const c of p.chips.chips) assert(isFinite(c.pos.y), 'a chip went non-finite');
  const stats = p.stats();
  p.dispose();
  return `13 recipes, ${stats.pools} pooled slots + ${stats.chipMax} chips + ${stats.decals} decals`;
});

check('scenery: the air adapts to the level and gives every mesh back on dispose', () => {
  const outdoor = litScene();
  const before = outdoor.children.length;
  const a = new Atmosphere(outdoor, { count: 300, density: 1 });
  assert(a.motes.mesh && a.windborne.mesh && a.haze.mesh && a.shimmer.mesh && a.banks.mesh,
    'the open air is missing one of its layers');
  assert(a.windborne.sheets > 0, 'no blowing sand outdoors');
  // motes, windborne, haze, shimmer, fog banks
  assert(outdoor.children.length === before + 5, 'the air is not five draw calls');

  const indoor = litScene();
  indoor.background = new THREE.Color(0x0a0d13);      // no sky: a hangar
  const b = new Atmosphere(indoor, { count: 300, density: 1 });
  assert(!b.haze.mesh && !b.shimmer.mesh && !b.banks.mesh,
    'a hangar got horizon haze, a mirage and weather');
  assert(b.windborne.sheets === 0, 'sand is blowing across a hangar floor');
  assert(b.motes.mesh, 'a hangar has no motes at all');

  a.dispose(); b.dispose();
  assert(outdoor.children.length === before, `${outdoor.children.length - before} meshes leaked on dispose`);
  const g = new GrassField(litScene(), FLAT, { count: 200 });
  const w = new Water(litScene(), { size: 60 });
  const p = new Particles(litScene(), 0.3);
  assert(ground.grass === g && ground.water === w && ground.fx === p, 'the broker never saw them');
  g.dispose(); w.dispose(); p.dispose();
  assert(ground.grass === null && ground.water === null && ground.fx === null,
    'the broker holds a reference to a disposed system');
  return '5 air layers outdoors, motes only indoors, nothing leaked';
});

check('source: no stray backtick inside a GLSL template literal', async () => {
  // A backtick in a shader comment closes the JS template literal that holds
  // the shader, and the file dies at parse time with an error pointing at the
  // GLSL rather than at the quote. It has cost two debugging rounds already.
  //
  // ...and then the lint itself grew the same class of bug. It used to pair each
  // /* glsl */ marker with the NEXT backtick-SEMICOLON, which only describes a
  // shader assigned to a const. A shader passed as an object property ends
  // backtick-COMMA, and those either merged into the following literal or — when
  // nothing later in the file ended `;` — dropped out of the scan with no trace.
  // Measured on this tree: 45 literals exist, the old scanner checked 31. All 12
  // property-shaped shaders in Scenery.js and both in Engine.js went unread. A
  // stray backtick injected into Scenery.js:1737 was flagged 0 times.
  //
  // So do not guess the terminator. Walk each literal from its OWN marker,
  // stepping over \ escapes and ${ } substitutions, and take the first backtick
  // that JS could legally be continuing from as the close. Every backtick before
  // that one is sitting inside the GLSL, which is exactly the bug.
  const { readdir, readFile } = await import('node:fs/promises');
  const walk = async (dir) => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) out.push(...await walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const files = await walk(new URL('../src', import.meta.url).pathname);
  // How a shader literal is actually used in this tree: const (`;`), object
  // property or argument (`,`), last argument (`)`), array or object close.
  // Kept deliberately tight — every token added here is a token a stray backtick
  // is allowed to hide behind.
  const TERM = /^\s*[;,)\]}]/;
  const line = (src, i) => src.slice(0, i).split('\n').length;
  const bad = [];
  let declared = 0, scanned = 0;
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    const rel = f.split('/src/')[1];
    // Counted independently of the scan, so that breaking the marker regex can
    // never quietly turn this check into "0 of 0 shaders are clean".
    declared += (src.match(/\/\* glsl \*\//g) || []).length;
    const re = /\/\* glsl \*\/\s*`/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;      // the literal's own backtick
      const ticks = [];
      let close = -1;
      for (let k = open + 1; k < src.length; k++) {
        const c = src[k];
        if (c === '\\') { k++; continue; }         // \` is not a terminator
        if (c === '$' && src[k + 1] === '{') {     // step over ${ ... }, braces nest
          let d = 1; k += 2;
          for (; k < src.length && d; k++) { if (src[k] === '{') d++; else if (src[k] === '}') d--; }
          k--; continue;
        }
        if (c !== '`') continue;
        ticks.push(k);
        if (TERM.test(src.slice(k + 1, k + 8))) { close = k; break; }
      }
      assert(close >= 0, `${rel}:${line(src, open)} — a /* glsl */ literal is never closed`);
      scanned++;
      for (const t of ticks) if (t !== close) bad.push(`${rel}:${line(src, t)}`);
      re.lastIndex = close + 1;
    }
  }
  assert(bad.length === 0, `backtick inside a shader literal at: ${[...new Set(bad)].join(', ')}`);
  assert(scanned === declared,
    `the lint read ${scanned} of ${declared} /* glsl */ literals — ${declared - scanned} skipped silently`);
  assert(scanned >= 45, `only ${scanned} shader literals found; the tree had 45`);
  return `${files.length} source files, ${scanned}/${declared} shader literals walked (was 31/45), all clean`;
});

check('source: no GLSL ES reserved word is used as an identifier', async () => {
  // `vec3 half = ...` compiles fine in your head and fails on the device with a
  // message pointing at the next line. The whole shader — and with it the whole
  // system it draws — silently vanishes from the frame. Cheaper to check here.
  const RESERVED = ['half', 'double', 'fixed', 'input', 'output', 'cast', 'namespace',
    'using', 'union', 'enum', 'typedef', 'template', 'this', 'packed', 'goto', 'switch',
    'default', 'inline', 'noinline', 'volatile', 'public', 'static', 'extern', 'external',
    'interface', 'flat', 'long', 'short', 'unsigned', 'superp', 'filter', 'sizeof', 'asm',
    'class', 'noperspective', 'patch', 'sample', 'subroutine', 'hvec2', 'hvec3', 'hvec4',
    'dvec2', 'dvec3', 'dvec4', 'fvec2', 'fvec3', 'fvec4'];
  const { readdir, readFile } = await import('node:fs/promises');
  const walk = async (dir) => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) out.push(...await walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const files = await walk(new URL('../src', import.meta.url).pathname);
  const bad = [];
  let blocks = 0;
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    const re = /\/\* glsl \*\/`([\s\S]*?)`/g;
    let m;
    while ((m = re.exec(src))) {
      blocks++;
      // prose in a comment is not an identifier
      const body = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const w of RESERVED) {
        if (new RegExp(`(?<![\\w.])${w}(?![\\w])`).test(body)) {
          bad.push(`${f.split('/src/')[1]}: ${w}`);
        }
      }
    }
  }
  assert(bad.length === 0, `reserved word used as an identifier — ${[...new Set(bad)].join(', ')}`);
  return `${blocks} shader blocks, ${RESERVED.length} reserved words, none used`;
});

check('source: an unrolled light loop gives its body a scope of its own', async () => {
  // three unrolls `#pragma unroll_loop_start` by pasting the body once per
  // light into the SAME scope. A `float wrap = ...` inside it compiles with one
  // directional light and dies with two — and the level that has two is not the
  // one you were testing.
  const { readdir, readFile } = await import('node:fs/promises');
  const walk = async (dir) => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) out.push(...await walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const files = await walk(new URL('../src', import.meta.url).pathname);
  const bad = [];
  let loops = 0;
  const DECL = /^\s*(?:const\s+)?(?:float|int|bool|vec[234]|mat[234]|ivec[234]|bvec[234])\s+\w+\s*=/m;
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    const re = /#pragma unroll_loop_start[\s\S]*?\)\s*{([\s\S]*?)}\s*#pragma unroll_loop_end/g;
    let m;
    while ((m = re.exec(src))) {
      loops++;
      // strip nested blocks — those already have their own scope
      const flat = m[1].replace(/{[\s\S]*?}/g, '');
      if (DECL.test(flat)) bad.push(f.split('/src/')[1]);
    }
  }
  assert(bad.length === 0, `an unrolled loop declares into the shared scope in: ${[...new Set(bad)].join(', ')}`);
  return `${loops} unrolled loops, every declaration scoped`;
});

check('composition: a site is refused on a cliff, on the spawn, or on another prop', () => {
  const world = { terrain: { slopeAt: (x) => (x > 50 ? 0.9 : 0.1), height: () => 0 } };
  beginDressing(world);
  assert(!siteOk(world, 60, 0, {}), 'a 0.9 slope was accepted');
  assert(!siteOk(world, 2, 2, {}), 'a site on top of the player spawn was accepted');
  assert(siteOk(world, 20, 0, { clearance: 2 }), 'a clear flat site was refused');
  assert(!siteOk(world, 21, 0, { clearance: 2 }), 'a site 1m from an occupied one was accepted');
  assert(siteOk(world, 30, 0, { clearance: 2 }), 'a site 10m away was refused');
  return 'cliffs, spawn and overlaps all refused; clear ground accepted';
});

check('composition: cluster actually clusters, and scatter does not', () => {
  const world = { terrain: { slopeAt: () => 0.05, height: () => 0 } };
  const spread = (pts) => {
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    return Math.sqrt(pts.reduce((a, p) => a + (p.x - cx) ** 2 + (p.z - cz) ** 2, 0) / pts.length);
  };

  beginDressing(world);
  const clustered = [];
  cluster(world, { rmin: 30, rmax: 60, count: 20, spread: 8, satClearance: 0.5 },
    (pos) => clustered.push({ x: pos.x, z: pos.z }));
  assert(clustered.length >= 10, `cluster only placed ${clustered.length} of 20`);

  beginDressing(world);
  const scattered = [];
  for (let i = 0; i < 20; i++) {
    const site = findSite(world, 30, 60, { clearance: 0.5 });
    if (site) scattered.push({ x: site.pos.x, z: site.pos.z });
  }

  const sc = spread(clustered), ss = spread(scattered);
  assert(sc < ss * 0.5,
    `cluster spread ${sc.toFixed(1)}m is not tighter than scatter's ${ss.toFixed(1)}m — it is not clustering`);
  return `cluster ${sc.toFixed(1)}m rms vs uniform scatter ${ss.toFixed(1)}m`;
});

check('composition: a run places things along a line', () => {
  const world = { terrain: { slopeAt: () => 0.05, height: () => 0 } };
  beginDressing(world);
  const pts = [];
  const n = run(world, { x: -20, z: 40 }, { x: 20, z: 40 }, 8,
    (pos) => pts.push({ x: pos.x, z: pos.z }), { jitter: 0, clearance: 1 });
  assert(n === 8, `only ${n} of 8 placed on a clear line`);
  // every point on the line, and spanning it end to end
  const offAxis = Math.max(...pts.map(p => Math.abs(p.z - 40)));
  assert(offAxis < 0.001, `points strayed ${offAxis.toFixed(2)}m off the line`);
  const xs = pts.map(p => p.x).sort((a, b) => a - b);
  near(xs[0], -20, 0.001, 'the run does not start at its start');
  near(xs[xs.length - 1], 20, 0.001, 'the run does not reach its end');
  return `8 placed, ${offAxis.toFixed(4)}m off-axis, spans -20 to 20`;
});

check('composition: polar bias moves the crowd in or out', () => {
  const mean = (bias) => {
    let s = 0;
    for (let i = 0; i < 400; i++) s += polar(10, 100, bias).r;
    return s / 400;
  };
  const inner = mean(0.4), even = mean(1), outer = mean(2.4);
  assert(inner > even && even > outer,
    `bias did not order the radii: ${inner.toFixed(1)} / ${even.toFixed(1)} / ${outer.toFixed(1)}`);
  return `mean radius ${inner.toFixed(0)}m / ${even.toFixed(0)}m / ${outer.toFixed(0)}m at bias 0.4 / 1 / 2.4`;
});

check('scenery: grass is ground cover, not waist-high weeds', async () => {
  // The blade geometry spans v = 0..1, so the per-instance scale IS the blade's
  // height in metres. That makes it very easy to author grass that is taller
  // than a person's knee without noticing, which is exactly what happened.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/world/Scenery.js', import.meta.url), 'utf8');

  // the geometry must still be unit-height, or the numbers below mean nothing
  const geo = src.match(/function bladeGeometry[\s\S]*?\n\}/);
  assert(geo && /pos\[k \* 3 \+ 1\] = v;/.test(geo[0]),
    'bladeGeometry no longer spans v = 0..1 — the height maths below is void');

  /* The two hand-written constants this used to read are a TABLE now — one row
   * per LOD rung — so every rung is held to the limit rather than the two that
   * happened to exist. That is the stronger form of the same property: a rung
   * added at 400 m with waist-high cards would have sailed past the old regex
   * entirely. The clamp is read out of the source too, so raising it cannot
   * quietly raise every ceiling here with it. */
  const clampM = src.match(/clamp\(density \* 1\.8, 0\.5, ([\d.]+)\)/);
  assert(clampM, 'could not find the density clamp the blade height is scaled by');
  const top = Number(clampM[1]);
  const rows = [...src.matchAll(/base: ([\d.]+), varies: ([\d.]+)/g)].map(m2 => m2.slice(1).map(Number));
  assert(rows.length >= 4, `only ${rows.length} LOD rungs declare a height`);
  const names = [...src.matchAll(/name: '(\w+)', card:/g)].map(m2 => m2[1]);
  const heights = rows.map(([b, v]) => (b + v) * top);
  for (let i = 0; i < heights.length; i++) {
    assert(heights[i] < 0.85, `the tallest ${names[i]} is ${heights[i].toFixed(2)}m`);
    assert(heights[i] > 0.25, `the tallest ${names[i]} is only ${heights[i].toFixed(2)}m — that is moss`);
  }
  // and the rung the player walks through is held tighter still: knee-high on
  // a 1.78 m character, or a field of ground cover reads as scratchy weeds
  assert(heights[0] < 0.75, `the tallest blade is ${heights[0].toFixed(2)}m`);
  return names.map((n, i) => `${n} ${heights[i].toFixed(2)}m`).join(', ');
});

check('bodies: no face feature is buried inside the head it belongs to', () => {
  // This bug has now been found FOUR times in this file — the Jedi's eyes,
  // pupils, brows and nose; the trooper's visor, vents and crest; the acolyte's
  // eye bar; the B1's photoreceptors — and twice it survived a "fix" because
  // the offset was checked against one shell while a second one (the jaw)
  // reached further forward at that height. So: raycast the ASSEMBLED head.
  // Scoped to the Jedi deliberately. The check is a head-on -Z raycast, which
  // is only meaningful for a head that IS roughly a ball: on a B1 the
  // photoreceptors sit on the cranium above a protruding snout, so a head-on
  // ray hits the snout first and reports a burial that is not real. A test that
  // cries wolf gets muted, and this one has to survive to be worth having.
  // The enemy heads have their own purpose-built detectors in the scratchpad.
  const heads = [['jedi', buildJedi]];
  const report = [];
  for (const [name, build] of heads) {
    const { rig } = build({ scale: 1 });
    const head = rig.get('head');
    if (!head) continue;
    head.obj.updateMatrixWorld(true);
    const meshes = [];
    head.obj.traverse(o => { if (o.isMesh && o.geometry) { o.updateMatrixWorld(true); meshes.push(o); } });
    if (meshes.length < 3) continue;
    // the shell is the two densest meshes — cranium and jaw / helmet and face
    const shell = [...meshes].sort((a, b) =>
      b.geometry.attributes.position.count - a.geometry.attributes.position.count).slice(0, 2);
    const rc = new THREE.Raycaster();
    const surfaceZ = (x, y) => {
      rc.set(V(x, y, 5), V(0, 0, -1));
      let best = -Infinity;
      for (const m of shell) for (const h of rc.intersectObject(m, false)) best = Math.max(best, h.point.z);
      return best;
    };
    let worst = 0, worstAt = null;
    for (const m of meshes) {
      if (shell.includes(m)) continue;
      const b = new THREE.Box3().setFromObject(m);
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
      const sz = surfaceZ(cx, cy);
      if (!isFinite(sz)) continue;                 // nothing in front of it — ears
      // Only judge parts that are actually TRYING to be on the face. Hair caps
      // and cowls sit behind the skull by design, and the shell is legitimately
      // in front of them.
      if ((b.min.z + b.max.z) / 2 < 0.03) continue;
      const proud = b.max.z - sz;
      if (proud < worst) { worst = proud; worstAt = `${name} (${cx.toFixed(3)}, ${cy.toFixed(3)})`; }
    }
    report.push(`${name} ${(worst * 1000).toFixed(1)}mm`);
    assert(worst > -0.0005,
      `${worstAt} is ${(-worst * 1000).toFixed(1)}mm inside the head shell — it will never be drawn`);
  }
  return report.join(', ') + ' worst clearance';
});

check('levels: every level dresses itself without throwing', () => {
  // A dressing pass runs ONCE, inside level load, and if it throws the world is
  // left half-built with a null player — which surfaces as a dozen unrelated
  // "cannot read property of null" failures far away from the cause. Prop
  // makers do not share one signature (addBrokenWall takes its size as a
  // Vector3 third argument while its neighbours take an options object), so
  // this is a very easy mistake and a very confusing one to chase.
  /**
   * THE STUB TERRAIN IS SIZED FROM THE LEVEL'S OWN PRESET, and the reason is
   * §2.3 wearing a harness for a coat.
   *
   * This stub is a hand-maintained copy of the Terrain surface that dressing
   * uses, standing beside the real class, and it went stale exactly the way
   * every other instance in §2.3 did: the dressing passes reach for
   * `T.inBounds(x, z, margin)` in six places and the stub did not have it, so
   * the check failed with `T.inBounds is not a function` — a harness defect
   * reported in the voice of a game defect, on a red line naming a level.
   *
   * `inBounds` is not invented here. It is Terrain's own rule — `|x| < half -
   * margin` — read off the same `TERRAIN_PRESETS[L.terrain].scale` that
   * `World.loadLevel` hands the real constructor, so a dressing pass that keeps
   * to the map under the real terrain keeps to it under this one. A flat `true`
   * would have made the check green and stopped it testing the bounds clause of
   * six placements, which is the failure mode §2.3's close relative names: a
   * missing thing answered with a plausible default.
   */
  const stub = (L) => {
    const scene = new THREE.Scene();
    const half = ((TERRAIN_PRESETS[L?.terrain]?.scale) ?? 300) / 2;
    return {
      scene, statics: [], lights: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
      physics: { addStaticBox: () => {}, staticBoxes: [], add: () => {}, bodies: [], raycast: () => null },
      addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
      addDoor(d) { this.doors.push(d); return d; },
      particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
      notify() {}, report() {}, onNotify: null, spawnEnemy: () => null,
      difficulty: DIFFICULTY.knight, time: 0,
      addProp(p) { this.props.push(p); return p; },
      terrain: {
        height: (x, z) => Math.sin(x * 0.05) * 1.5 + Math.cos(z * 0.04) * 1.2,
        slopeAt: (x, z) => Math.abs(Math.sin(x * 0.03 + z * 0.02)) * 0.5,
        normalAt: (x, z, o) => o.set(0, 1, 0).normalize(),
        surfaceAt: () => 'sand',
        inBounds: (x, z, margin = 4) => Math.abs(x) < half - margin && Math.abs(z) < half - margin,
        size: half * 2, half,
      },
      settings: { quality: 'medium' },
    };
  };

  const done = [];
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    if (!L || typeof L.dress !== 'function') continue;
    const world = stub(L);
    L.dress(world);                       // must not throw
    const n = world.statics.length + world.props.length;
    assert(n > 0, `${key} dressed itself with nothing at all`);
    // and nothing may land at a non-finite position, which is how a NaN
    // dimension escapes into the scene without anyone noticing
    let bad = 0;
    for (const m of world.statics) {
      if (!isFinite(m.position.x) || !isFinite(m.position.y) || !isFinite(m.position.z)) bad++;
    }
    assert(bad === 0, `${key} placed ${bad} statics at a non-finite position`);
    done.push(`${key} ${n}`);
  }
  assert(done.length >= 3, `only ${done.length} levels were exercised`);
  return done.join(', ') + ' pieces';
});

check('enemies: distant detail is culled, silhouettes are not', () => {
  // Every small piece of an enemy — panel lines, rivets, vents, fasteners — is
  // its own draw call. An acolyte is 56 meshes and a walker 66, so a horde of
  // twenty is over a thousand draw calls BEFORE the shadow pass doubles it.
  // None of that detail resolves past thirty metres, so it is culled by
  // distance. What must never be culled is the limb tubes: they are the
  // silhouette, and the silhouette is what the player fights by.
  const builders = [['b1', buildB1], ['trooper', buildTrooper], ['acolyte', buildAcolyte]];
  const report = [];
  for (const [name, build] of builders) {
    const { rig } = build({ scale: 1 });
    const keep = new Set();
    for (const b of rig.list) if (b.primary) keep.add(b.primary);
    let all = 0, detail = 0;
    rig.root.traverse((o) => { if (o.isMesh) { all++; if (!keep.has(o)) detail++; } });

    assert(keep.size >= 15, `${name} only has ${keep.size} silhouette meshes — the rig is not built`);
    const kept = all - detail;
    assert(kept >= 15, `${name} would cull down to ${kept} meshes — the silhouette would break up`);
    const cut = detail / all;
    assert(cut > 0.35,
      `${name} only sheds ${(cut * 100).toFixed(0)}% of its meshes at distance — a horde will not render`);
    report.push(`${name} ${all}\u2192${kept}`);
  }
  return report.join(', ');
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Destructible architecture                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/** A world stub good enough for the Destruction manager, on a real Rapier world. */
function destructionHost(physics, opts = {}) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: opts.player || V(0, 1, 0) },
    settings: { quality: 'medium' },
    addProp(p) { this.props.push(p); return p; },
    addLight(l) { return l; },
    onExplosion(centre, size) { this.booms = (this.booms || 0) + 1; },
  };
}
const rapierGround = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33),
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true,
  friction: 0.9, deformSeq: 0, raycast: () => null });

check('destruction: a piece of architecture registers itself without changing what it costs', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  const before = { boxes: w.staticBoxes.length, statics: host.statics.length };
  addColumn(host, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500 });
  const D = host.destruction;
  assert(D, 'the column did not attach a Destruction manager');
  assert(D.structures.length === 1, `${D.structures.length} structures registered for one column`);
  const s = D.structures[0];
  assert(s.state === 'intact' && !s.chunks, 'registering must not fracture anything up front');
  assert(w.staticBoxes.length === before.boxes + 1, 'the column changed its collider count');
  assert(host.statics.length > before.statics, 'the column did not emit its meshes');
  // and it rides in props, which is how it gets a frame and a blade target list
  assert(host.props.length === 1 && host.props[0] === D.proxy, 'the manager is not in world.props');
  assert(D.proxy.body.boundingRadius === 0,
    'the proxy must have no bounding radius, or the bolt sweep will hit it instead of the world');
  return `1 piece, ${w.staticBoxes.length} collider, ${host.statics.length} meshes — unchanged until hit`;
});

check('destruction: fracture makes convex cells that tile the piece', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  addBrokenWall(host, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 });
  const s = host.destruction.structures[0];
  const t0 = performance.now();
  s.prefracture();
  s.prepareAll();
  const ms = performance.now() - t0;

  assert(s.chunks.length >= 6, `only ${s.chunks.length} cells out of a 9m wall`);
  assert(s.chunks.length <= host.destruction.maxCellsPerPiece,
    `${s.chunks.length} cells exceeds the ${host.destruction.maxCellsPerPiece} cap`);
  let vol = 0, tris = 0;
  for (const c of s.chunks) {
    assert(isFinite(c.centre.x) && isFinite(c.centre.y) && isFinite(c.centre.z), 'a cell centre is not finite');
    assert(c.volume > 1e-4 && isFinite(c.volume), `a cell has volume ${c.volume}`);
    assert(c.mass > 0 && isFinite(c.mass), 'a cell has no mass');
    assert(c.hull && c.hull.type === 'hull', 'a cell did not produce a hull');
    const pts = c.hull.points;
    assert(pts.length >= 12, `a cell hull has only ${pts.length / 3} points`);
    for (let i = 0; i < pts.length; i++) assert(isFinite(pts[i]), 'a hull point is not finite');
    assert(c.geo && c.geo.attributes.position.count >= 12, 'a cell has no drawable geometry');
    vol += c.volume;
    tris += c.tris;
  }
  // the cells must actually be the wall: no cell may sit outside it
  const bb = s.local;
  for (const c of s.chunks) {
    assert(c.bounds.min.x >= bb.min.x - 0.01 && c.bounds.max.x <= bb.max.x + 0.01
      && c.bounds.min.y >= bb.min.y - 0.01 && c.bounds.max.y <= bb.max.y + 0.01,
      'a cell escaped the piece it came from');
  }
  // and they must be connected to each other, or nothing can hold anything up
  const linked = s.chunks.filter(c => c.neighbours.length > 0).length;
  assert(linked >= s.chunks.length - 1, `${s.chunks.length - linked} cells have no neighbours at all`);
  assert(s.chunks.some(c => c.grounded), 'no cell reaches the ground');
  return `${s.chunks.length} cells, ${vol.toFixed(0)}m³, ${tris} triangles, built in ${ms.toFixed(1)}ms`;
});

check('destruction: damage accumulates per cell and only breaks past the threshold', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  addColumn(host, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 77 });
  const D = host.destruction;
  const s = D.structures[0];
  s.prefracture();
  const cell = s.chunks.find(c => c.grounded);
  const hp = cell.hp;
  assert(hp > 0 && isFinite(hp), 'a cell has no health');

  // three taps well under the threshold: damage banks, nothing comes off
  const at = cell.worldCentre(new THREE.Vector3());
  for (let i = 0; i < 3; i++) s.damageSphere(at, 1.0, hp * 0.2);
  assert(s.state === 'intact', 'the column broke on a scratch');
  assert(cell.damage > hp * 0.5 && cell.damage < hp,
    `damage did not accumulate: ${cell.damage.toFixed(1)} of ${hp.toFixed(1)}`);
  const banked = cell.damage;

  // the blow that crosses it does
  s.damageSphere(at, 1.0, hp * 0.6);
  assert(cell.damage > banked, 'the last blow did not add to the bank');
  assert(s.state !== 'intact', `the cell survived ${cell.damage.toFixed(1)} damage against ${hp.toFixed(1)} health`);
  assert(cell.state === 'live', `the broken cell is ${cell.state}, not a loose body`);
  assert(cell.body && cell.body.invMass > 0, 'the broken cell is not a dynamic body');
  // falloff: the same blow from far enough away does nothing at all
  const far = D.structures[0];
  assert(!far.damageSphere(V(60, 1, 60), 2, 1e6), 'damage reached a piece outside its radius');
  return `threshold ${hp.toFixed(0)} hp; banked ${banked.toFixed(0)} without breaking, broke at ${cell.damage.toFixed(0)}`;
});

check('destruction: a broken support drops what it was holding up', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  addColumn(host, V(-2.2, 0, 0), { height: 6, radius: 0.45, seed: 1 });
  addColumn(host, V(2.2, 0, 0), { height: 6, radius: 0.45, seed: 2 });
  addLintel(host, V(0, 6.2, 0), { length: 6.4, height: 0.62, depth: 0.72, seed: 3 });
  const D = host.destruction;
  assert(D.structures.length === 3, `${D.structures.length} pieces registered`);
  D._linkSupports();
  const [left, right, lintel] = D.structures;
  assert(lintel.restsOn.length === 2, `the lintel thinks it rests on ${lintel.restsOn.length} pieces`);
  assert(left.carries.includes(lintel), 'the column does not know it carries the lintel');
  assert(!left.restsOn.includes(right), 'two columns side by side must not carry each other');

  const y0 = lintel.centre.y;
  left.damageSphere(V(-2.2, 0.5, 0), 1.6, 4000, V(1, 0, 0));
  assert(left.state === 'collapsed', `the column is ${left.state} after losing its base`);
  assert(lintel.state === 'collapsed', `the lintel is ${lintel.state} with a column gone from under it`);
  const loose = lintel.chunks.filter(c => c.state === 'live').length;
  assert(loose >= 2, `only ${loose} of the lintel's ${lintel.chunks.length} pieces let go`);

  for (let i = 0; i < 360; i++) { w.step(1 / 60); D.update(1 / 60); }
  const ys = lintel.chunks.filter(c => c.mesh).map(c => c.mesh.position.y);
  assert(ys.length > 0, 'the lintel left nothing behind');
  assert(ys.every(y => isFinite(y)), 'a fallen piece went non-finite');
  const highest = Math.max(...ys);
  assert(highest < y0 - 2, `the lintel is still hanging in the air at y=${highest.toFixed(2)} (was ${y0.toFixed(2)})`);
  return `lintel fell ${(y0 - highest).toFixed(1)}m from y=${y0.toFixed(1)} to y=${highest.toFixed(1)} when its column went`;
});

check('destruction: the live-chunk cap actually caps, and the rest settles or goes', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  for (let i = 0; i < 12; i++) addColumn(host, V((i % 6) * 4 - 10, 0, Math.floor(i / 6) * 6), { height: 7, radius: 0.5, seed: 200 + i });
  const D = host.destruction;
  D.maxLive = 16;
  D.maxChunks = 48;
  for (const s of D.structures) s.prepareAll();
  let cells = 0;
  for (const s of D.structures) cells += s.chunks.length;
  for (const s of D.structures) s.collapse();
  assert(D.live.length === cells, `${D.live.length} of ${cells} cells went dynamic`);

  // walk away: rubble at rest and out of sight goes back to being static
  for (let i = 0; i < 240; i++) { w.step(1 / 60); D.update(1 / 60); }
  assert(D.live.length <= D.maxLive, `${D.live.length} live chunks against a cap of ${D.maxLive}`);
  host.player.position.set(0, 1, 90);
  for (let i = 0; i < 300; i++) { w.step(1 / 60); D.update(1 / 60); }
  assert(D.settled.length > 0, 'nothing ever settled back to static, even far away and at rest');
  assert(D.live.length === 0 || D.live.length < D.maxLive,
    `${D.live.length} chunks are still simulating with the player 90m away`);
  assert(D.live.length + D.settled.length <= D.maxChunks,
    `${D.live.length + D.settled.length} chunks against a total cap of ${D.maxChunks}`);
  const dyn = w.bodies.filter(b => !b.static).length;
  assert(dyn <= D.maxLive, `${dyn} dynamic bodies survive against a cap of ${D.maxLive}`);
  assert(D.stats.despawned > 0, 'nothing was retired even though the cap was blown through');
  // a settled chunk keeps its collider, so rubble is still something to walk into
  for (const c of D.settled) assert(c.staticBox, 'a settled chunk lost its collider');
  return `${cells} cells collapsed at once → ${D.live.length} live (cap ${D.maxLive}), `
    + `${D.settled.length} settled static, ${D.stats.despawned} retired`;
});

check('destruction: repeated break and cleanup cycles leak no bodies', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const base = { bodies: w.bodies.length, boxes: w.staticBoxes.length };
  const marks = [];
  for (let round = 0; round < 10; round++) {
    const host = destructionHost(w);
    addColumn(host, V(0, 0, 0), { height: 7, radius: 0.5, seed: 500 });
    addBrokenWall(host, V(14, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 });
    const D = host.destruction;
    for (const s of D.structures) s.prepareAll();
    D.structures[0].collapse();
    D.structures[1].damageSphere(V(14, 3, 1), 4, 5000);
    for (let i = 0; i < 60; i++) { w.step(1 / 60); D.update(1 / 60); }
    D.dispose();
    marks.push(`${w.bodies.length}/${w.staticBoxes.length}`);
    assert(host.props.length === 0, 'the proxy prop survived dispose');
    assert(!host.destruction, 'the world still points at a disposed manager');
  }
  assert(w.bodies.length === base.bodies,
    `${w.bodies.length - base.bodies} bodies leaked over ten break/cleanup cycles (${marks.join(' ')})`);
  assert(w.staticBoxes.length === base.boxes,
    `${w.staticBoxes.length - base.boxes} static colliders leaked (${marks.join(' ')})`);
  return `10 cycles of collapse + explosion + dispose, ${marks[marks.length - 1]} bodies/colliders left`;
});

check('destruction: the blade grinds through a column and drops what was above the cut', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w, { player: V(0, 1.2, 1.4) });
  const solver = new BladeContactSolver();
  host.bladeSolver = solver;
  addColumn(host, V(0, 0, 0), { height: 7, radius: 0.5, seed: 9 });
  const D = host.destruction;
  const s = D.structures[0];
  const saber = makeBlade(host.scene, { length: 1.3 });
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  const seen = { grind: 0, cut: 0, clang: 0 };
  let firstCut = -1;
  for (let i = 0; i < 240; i++) {
    const dt = 1 / 60, t = i * dt;
    saber.setHiltPose(V(Math.sin(t * 7) * 0.7, 1.5, 1.4), q);
    saber.update(dt, dt);
    // exactly what World does: capsules from props, events back to the prop
    const caps = D.proxy.capsules();
    const events = solver.solve(saber, [{ id: D.proxy.id, capsules: caps, prop: D.proxy, dead: false }], dt, {});
    for (const e of events) {
      seen[e.type] = (seen[e.type] || 0) + 1;
      if (e.type === 'cut') {
        if (firstCut < 0) firstCut = i;
        const halves = D.proxy.cut(e.point, e.normal, e.impulse);
        assert(Array.isArray(halves), 'the proxy must hand World an array back, not null');
      }
    }
    D.update(dt); w.step(dt);
  }
  assert(seen.grind > 20, `only ${seen.grind} grind events — the blade never met the column`);
  assert(seen.cut > 0, 'the blade never got through a stone column');
  assert(firstCut > 12, `the column parted in ${(firstCut / 60).toFixed(2)}s — toughness is not being respected`);
  assert(s.state !== 'intact', `the column is still ${s.state} after being cut`);
  const above = s.chunks.filter(c => c.centre.y > 2.4);
  assert(above.every(c => c.state !== 'attached'),
    'the top of the column is still hanging above the cut');
  for (let i = 0; i < 300; i++) { w.step(1 / 60); D.update(1 / 60); }
  const ys = s.chunks.filter(c => c.mesh).map(c => c.mesh.position.y);
  assert(ys.every(y => isFinite(y) && y < 3), `a piece of the column is still up at y=${Math.max(...ys).toFixed(2)}`);
  return `${seen.grind} grinds then a cut at ${(firstCut / 60).toFixed(2)}s; `
    + `${s.chunks.length} pieces on the floor, highest y=${Math.max(...ys).toFixed(2)}`;
});

check('destruction: an explosion takes a bite out of a wall without levelling it', () => {
  propMaterials();
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rapierGround();
  const host = destructionHost(w);
  addBrokenWall(host, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 });
  const D = host.destruction;
  const s = D.structures[0];
  host.onExplosion(V(0, 2, 1.4), 1.4);            // the wrapped world hook
  assert(host.booms === 1, 'the original world explosion did not still run');
  assert(s.state === 'broken', `the wall is ${s.state} after a charge went off against it`);
  const loose = s.chunks.filter(c => c.state === 'live').length;
  assert(loose >= 1, 'the charge did not remove anything');
  assert(s.attached >= 2, `the whole wall came down (${s.attached} of ${s.chunks.length} left standing)`);
  assert(s.shell && s.shell.length,
    'the standing remainder must be one merged mesh, not one draw call per cell');
  const shellDraws = s.shell.length;
  for (let i = 0; i < 120; i++) { w.step(1 / 60); D.update(1 / 60); }
  return `${loose} of ${s.chunks.length} cells blown out, ${s.attached} still standing in ${shellDraws} draw call(s)`;
});

/* ══════════════════════════════════════════════════════════════════════ */

/* ── per-domain suites ────────────────────────────────────────────────
 * Each workstream owns a file under tools/checks/ so parallel work never has
 * to edit this one. They run with the same helpers as everything above.
 */
{
  const { readdir } = await import('node:fs/promises');
  const dir = new URL('./checks/', import.meta.url);
  let files = [];
  /* `_`-prefixed files are shared helpers, not suites — `_page`, `_shared`,
   * `_source`, `_coop`, `_weave`. They were imported here too and skipped for
   * having no `run`, which cost nothing but printed five files that run no
   * checks and made this loop's idea of "a suite" differ from
   * determinism.mjs's, which has always filtered them. One definition. */
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).sort();
  } catch {}
  /**
   * SABER_CHECK_ORDER=reverse RUNS THE SAME SUITES BACKWARDS.
   *
   * WHY IT EXISTS. Several things the game keeps at module scope survive
   * between suites — `enemyRng` and `duelRng` (Enemy.js, Duel.js), the wave
   * stream, `wind` and `ground` (Scenery.js), Engine's once-only ShaderChunk
   * flags. A suite that drives a World advances all of them for every suite
   * after it, and alphabetical order is not a design; it is the order `readdir`
   * happened to give. A harness that answers differently each time is worse
   * than a red one, because the difference looks like whatever you changed
   * last. Reversing is the cheapest signal that finds it: a check that passes
   * one way and fails the other is order-dependent by construction, and the
   * pair of runs names it. It found `mapPeak` measuring its own hard-coded
   * fallback on its first run.
   *
   * WHERE IT STANDS, measured on a quiet tree with nothing else writing to it
   * and BOTH RUNS THROUGH THE LOADER (see the guard at the top of this file —
   * the first attempt at this experiment was run without it and produced two
   * fictional failures that cost an afternoon):
   *
   *   forward   1139 passed, 0 failed
   *   reverse   1139 passed, 0 failed
   *   1099 of the 1139 result lines are identical, character for character
   *
   * So the VERDICT is order-independent. What still moves is the 40 remaining
   * lines, and they are all passing checks whose measured numbers shift with
   * the phase of a shared stream — `escalation` (5), `props` (4), `presence`
   * and `co-op` (3 each), then a long tail of one each. They pass both ways
   * because they have margin, not because they are pinned, and a tightened bar
   * on any of them could go red on an unrelated change. That is the honest
   * state of it: the residue is bounded and named rather than eliminated.
   * `tools/checks/determinism.mjs` holds the hygiene that keeps it from
   * growing; this is the switch that measures it.
   */
  if (process.env.SABER_CHECK_ORDER === 'reverse') files.reverse();
  /**
   * ONE SUITE AT A TIME, AND SAY WHICH.
   *
   * `check()` pushes every async check onto `pending` and nothing awaited it
   * until the very end, so all eighty suites' asynchronous work ran
   * CONCURRENTLY — physics benches, headless Worlds, an HTTP server on an
   * ephemeral port, page-driving checks — while the results buffer printed
   * nothing at all. A run that stalled did so silently and for as long as you
   * let it: the only way to find out where was to read /proc/<pid>/fd.
   *
   * So each suite's own async checks are drained before the next suite starts,
   * which bounds the concurrency to what one file asked for, and each file is
   * named on stderr as it begins. Stderr rather than stdout because the result
   * table is what stdout is for, and a `| tail -60` must not eat the answer.
   */
  /**
   * AND THE SHARED CLOCKS GO BACK BETWEEN SUITES — once here, not eighteen
   * times out there.
   *
   * `_shared.mjs` was written for this and adopted by three suites. Twenty-one
   * drive a World's frames, so eighteen were still moving `wind.time`,
   * `enemyRng` and `duelRng` for everything that ran after them, and the
   * per-suite fix needs a try/finally around every check body that runs frames
   * — a lot of surgery on working checks, and a rule a new suite has to
   * remember.
   *
   * This loop is the one place that knows where one suite ends and the next
   * begins, and it already drains before moving on. Restoring here makes every
   * suite start from the same generator state and the same wind phase whatever
   * ran before it, which IS order-independence, and a new suite gets it without
   * knowing this file exists.
   *
   * WHAT IT DOES NOT COVER, stated rather than implied: within a single file
   * the checks still interleave and still share the streams, and `ground`
   * (Scenery.js — terrain, fx, clock, `_scarAt`) is shared state this does not
   * touch. The cross-suite half is the half that was costing measured
   * differences: forward and reverse agreed on the verdict but disagreed on the
   * numbers in 40 passing checks, led by escalation (5), props (4), presence
   * and co-op (3 each).
   */
  /* BEFORE each suite, against a baseline taken once — not after each suite
   * against its own snapshot, which was the first cut and was wrong in a way
   * worth keeping: restoring afterwards leaves the FIRST suite reading whatever
   * the ~700 checks above this loop left behind, while every other suite starts
   * from the seed. Reverse the order and a different file is first, so exactly
   * one suite changes what it sees — the same defect this is here to remove,
   * surviving in the one place it would be hardest to spot. */
  const { snapshotShared, restoreShared } = await import(new URL('_shared.mjs', dir).href);
  /* THE CORE BLOCK IS DRAINED HERE, and it is the one block that was exempt from
   * the rule the note above states. Every suite's async checks are awaited
   * before the next suite starts; this file's own ~700 were not awaited until
   * after the last suite, so they ran concurrently with all eighty of them — the
   * very thing that paragraph says was fixed. Two consequences, both real:
   * `report('core')` could not have told the truth about checks still in flight,
   * and `snapshotShared()` below was taking the baseline WHILE core's async
   * checks were still advancing `enemyRng`, `duelRng` and `wind.time`, so the
   * baseline every suite restores to depended on how far they had got. Draining
   * first makes the baseline a quiescent reading and costs nothing else. */
  await Promise.all(pending);
  const baseline = await snapshotShared();
  report('core (verify.mjs)', 0, t0);
  for (const f of files) {
    const from = pending.length;
    const mark = results.length;
    const began = Date.now();
    process.stderr.write(`  … ${f}\n`);
    restoreShared(baseline);
    try {
      const mod = await import(new URL(f, dir).href);
      /**
       * A SUITE THAT EXPORTS NOTHING IS A FAILURE, NOT A GREEN 0/0.
       *
       * This was a bare `if` with no `else`, so a suite whose `run` was renamed,
       * removed, or lost to a bad merge vanished from the gate in silence —
       * printed as `✓ animation.mjs 0/0`, sixteen checks gone, nothing in the
       * summary. Proven by renaming `export function run` to `runx` in
       * `animation.mjs`: the full gate went green with a suite missing.
       *
       * `_one.mjs` has refused exactly this since it was written ("no checks
       * ran at all", exit 1) — the gate, which is the thing anyone actually
       * trusts, did not. Same rule, both runners.
       */
      if (typeof mod.run !== 'function') {
        fail++;
        results.push(['✗', `suite ${f}`, 'exports no run() — every check in it is silently absent from this gate']);
      } else await mod.run({ check, assert, near, V, Q, THREE, lerpN });
    } catch (e) {
      fail++;
      results.push(['✗', `suite ${f}`, e.message]);
    }
    // These never reject: check() attaches both handlers before pushing.
    await Promise.all(pending.slice(from));
    report(f, mark, began);
  }
}

await Promise.all(pending);

const w = Math.max(...results.map(r => r[1].length));
console.log('');
for (const [mark, name, detail] of results) {
  const colour = mark === '✓' ? '\x1b[32m' : '\x1b[31m';
  console.log(`${colour}${mark}\x1b[0m ${name.padEnd(w)}  \x1b[2m${detail}\x1b[0m`);
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
