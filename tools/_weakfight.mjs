/**
 * PROBE (not a check): how many PASSES a big body takes through each route,
 * driven through the shipped `Enemy.takeCut` with the guard UP.
 *
 * Why this exists beside `tools/_weakgain.mjs`: `balance.engagementFor` models
 * the turn with `guardFor` + `_fightEnding`, which was a complete account of
 * `_turnCut`'s gates until a weak point became a fourth one — so it reports the
 * spatial opening as worth nothing (HANDOFF §2.4, in the instrument). This
 * calls the real method on a real body instead and cannot disagree with it.
 *
 *   node --import ./tools/register.mjs tools/_weakfight.mjs [archetype…]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Enemy, ARCHETYPES, guardFor, hasWeakPoints, TURNED_CUT } from '../src/game/Enemy.js';
import * as PHYS from '../src/physics/RapierWorld.js';
import { initPhysics } from '../src/physics/Rapier.js';
import '../src/game/Levels.js';
import '../src/game/Vehicles.js';

await initPhysics();

const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {}, slopeAt: () => 0 };
const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
  spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} } };
function live(type) {
  const w = {
    scene: new THREE.Scene(), physics: new PHYS.RapierWorld({ gravity: -24, iterations: 4, maxBodies: 96 }),
    terrain, statics: [], settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [], particles,
    bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  w.physics.terrain = terrain;
  const e = new Enemy(w, type, new THREE.Vector3(0, 0, -6));
  w.enemies.push(e);
  e.update(1 / 60, { enemies: w.enemies, particles, terrain, physics: w.physics,
    bolts: w.bolts, time: 0, pickTarget: () => null, camera: w.engine.camera });
  return e;
}

/**
 * Cut the same PLACE until the body dies, guard up, and count the passes.
 *
 * `pick` chooses a capsule out of the live `capsules()` every pass, so when a
 * limb comes off the next pass finds the next one of its kind — which is what a
 * player working down a walker's legs actually does.
 */
function passesToKill(type, pick, cap = 40) {
  const e = live(type);
  try {
    let n = 0, turned = 0;
    while (!e.dead && n < cap) {
      const c = e.capsules().filter(pick)[0];
      if (!c) return { n, turned, dead: e.dead, hp: e.hp / e.maxHp, out: 'nothing left to cut' };
      const r = e.takeCut({ bone: c.name, cap: c, cutT: 0.5, point: e.position.clone().setY(1),
        impulse: new THREE.Vector3(0, 0, -1) }, null);
      n++; if (r === 'turned') turned++;
    }
    return { n, turned, dead: e.dead, hp: e.hp / e.maxHp, out: e.dead ? 'dead' : 'survived',
      legs: e.legsLost || 0, toppled: !!e.toppled };
  } finally { e.dispose?.(); }
}

const isGap = (c) => !!c.covers;
const want = process.argv.slice(2);
const keys = want.length ? want : Object.keys(ARCHETYPES).filter((k) => hasWeakPoints(ARCHETYPES[k]));
const rows = [];
for (const key of keys) {
  const A = ARCHETYPES[key];
  const probe = live(key);
  const caps = probe.capsules();
  const gaps = caps.filter(isGap);
  const limbGaps = gaps.filter((c) => c.opens);
  probe.dispose?.();
  const plate = passesToKill(key, (c) => !c.shield && !c.covers && c.vital < 0.9);
  const gap = limbGaps.length ? passesToKill(key, (c) => c.covers && c.opens) : null;
  rows.push([key, String(guardFor(A)), `${gaps.length}/${caps.length}`, String(limbGaps.length),
    `${plate.n}p ${plate.turned}t ${plate.legs}L${plate.toppled ? ' TOPPLE' : ''}`,
    gap ? `${gap.n}p ${gap.turned}t ${gap.legs}L${gap.toppled ? ' TOPPLE' : ''}` : '—',
    gap ? (plate.n / gap.n).toFixed(2) + '×' : '—']);
}
const hdr = ['body', 'grd', 'gaps', 'limb', 'plate route', 'joint route', 'gain'];
const w = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
console.log(hdr.map((h, i) => h.padEnd(w[i])).join('  '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
console.log(`\nTURNED_CUT ${TURNED_CUT} → a turned pass costs ${(TURNED_CUT * 100).toFixed(0)}% of max hp, `
  + `so ${Math.ceil(1 / TURNED_CUT)} of them kill anything.`);

/* ── and the other half: how many SWINGS one pass costs ────────────────────
 *
 * The table above calls `takeCut` directly, so it counts PASSES and is blind to
 * what a pass costs to complete. That is the half `thinner()` changes. This
 * sweeps a real `Saber` through the real `BladeContactSolver` at the authored
 * pass speed and counts swings until the solver raises its `cut`.
 *
 * The driver is this file's; the rule is the game's. `solve` decides everything
 * that matters — coverage, rush, softness, the fade, the budget — and the only
 * thing here is a hilt moved along a line.
 */
const { Saber } = await import('../src/game/Saber.js');
const { BladeContactSolver } = await import('../src/game/Combat.js');
const B2 = await import('./balance.mjs');
const scene = new THREE.Scene();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function swingsFor(cap, speed, reach) {
  const solver = new BladeContactSolver();
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: reach });
  try {
    saber.ignite(); saber.ignition = 1;
    const q = new THREE.Quaternion();
    const r = Math.min(cap.r, reach / 2);
    const half = Math.max(cap.p0.distanceTo(cap.p1) / 2, 0.02);
    const tgt = { id: 't', dead: false, capsules: [{ ...cap, r, p0: V(0, 1.2, -half), p1: V(0, 1.2, half) }] };
    const dt = 1 / 60, span = Math.max(1.2, 2 * r + 0.6), period = 0.8, travel = span / speed;
    let t = 0, swings = 0, last = -1;
    for (let f = 0; t < 24; f++, t += dt) {
      const ph = t % period;
      const n = Math.floor(t / period);
      if (n !== last) { last = n; swings++; }
      if (ph <= travel) saber.setHiltPose(V(-span / 2 + ph * speed, 0.55, 0), q);
      else { saber.valid = false; saber.setHiltPose(V(-span / 2, 0.55, 0), q); }
      saber.update(dt, t);
      for (const ev of solver.solve(saber, [tgt], dt, { power: 1 })) {
        if (ev.type === 'cut') return swings;
      }
    }
    return Infinity;
  } finally { saber.dispose(); }
}

const passSpeed = B2.measureSwing().passSpeed;
console.log(`\nswings to complete ONE pass, at the authored pass speed ${passSpeed.toFixed(1)} m/s:`);
const rows2 = [];
for (const key of keys) {
  const e = live(key);
  const caps = e.capsules();
  e.dispose?.();
  const gaps = caps.filter(isGap);
  if (!gaps.length) { rows2.push([key, '—', '—', '—', 'no gaps']); continue; }
  for (const g of gaps.filter((c, i, a) => a.findIndex((x) => x.name.replace(/\d+/g, '#') === c.name.replace(/\d+/g, '#')) === i)) {
    const host = caps.find((c) => c.name === g.covers);
    const sg = swingsFor(g, passSpeed, 1.15), sh = swingsFor(host, passSpeed, 1.15);
    rows2.push([key, g.name, `${sh}`, `${sg}`, (sh / sg).toFixed(2) + '×' + (g.opens ? '  unturned' : '')]);
  }
}
const hdr2 = ['body', 'gap', 'host swings', 'gap swings', 'gain'];
const w2 = hdr2.map((h, i) => Math.max(h.length, ...rows2.map((r) => String(r[i]).length)));
console.log(hdr2.map((h, i) => h.padEnd(w2[i])).join('  '));
for (const r of rows2) console.log(r.map((c, i) => String(c).padEnd(w2[i])).join('  '));
