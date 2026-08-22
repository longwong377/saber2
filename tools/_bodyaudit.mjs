/**
 * BATTLEFRONT BORZ — WHAT A LONG SESSION LEAVES BEHIND.
 *
 * A measurement, not an assertion. Boots one World, drives a scripted Jedi
 * through many waves, and takes a full census at intervals: the scene graph,
 * the Rapier world's OWN counters (not our mirrors of them), every collection
 * a body can be parked in, and the two things that fail silently — non-finite
 * transforms, and bodies that have come to rest under the ground.
 *
 *   node --import ./tools/register.mjs tools/_bodyaudit.mjs [--level colosseum]
 *      [--mode waves] [--seconds 600] [--every 30] [--seed 7] [--quality high]
 *
 * HANDOFF §2.5c: the script is ticked before every step, by hand, here.
 * HANDOFF §2.11: one process, one arm, one seeding at the top and no other.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const LEVEL = flag('level', 'colosseum');
const MODE = flag('mode', 'waves');
const SECONDS = Number(flag('seconds', '600'));
const EVERY = Number(flag('every', '30'));
const SEED = Number(flag('seed', '7'));
const QUALITY = flag('quality', 'high');
const STEP = 1 / 30;

const finite3 = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * A JEDI WHO ACTUALLY CLEARS THE ROOM, which `_flagship.mjs`'s `dutyInput` is
 * deliberately not: that one holds station on its line and only meets what
 * comes inside ENGAGE (14 m), because it is measuring a formation. Measured
 * here first, with it: the run stalls at 420 s with one B2 standing 34 m out,
 * shooting into a raised guard forever, and the next 480 game-seconds are a
 * still frame. A leak audit needs the fight to keep happening, so this one
 * walks at the nearest hostile wherever it is.
 *
 * HANDOFF §2.5c: `tick` is the whole body, and this file's own loop calls it.
 */
function hunterInput(world) {
  const hit = new Set();
  let swing = 0, alt = 0, push = 0;
  const axis = { x: 0, y: 0 };
  const input = {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { if (o) { o.x = axis.x; o.y = axis.y; return o; } return { ...axis }; },
    act: (id) => id === 'blade',
    actHit: (id) => hit.has(id), actDown: (id) => hit.has(id),
    end() {},
  };
  input.tick = (dt) => {
    hit.clear();
    const p = world.player;
    if (!p) { axis.x = axis.y = 0; return; }
    /* Kept alive so the audit measures a session and not a death. */
    if (p.alive && p.hp < p.maxHp * 0.5) p.hp = p.maxHp;
    if (!p.alive) { axis.x = axis.y = 0; return; }
    if (p.saber && !p.saber.lit) p.saber.ignite();
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (e.dead || e.team === p.team) continue;
      const d = e.position.distanceToSquared(p.position);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) { axis.x = axis.y = 0; return; }
    const dist = Math.sqrt(bd);
    p.camera.yaw = Math.atan2(-(best.position.x - p.position.x), -(best.position.z - p.position.z));
    axis.x = 0; axis.y = dist > 2.2 ? 1 : 0;
    if (dist < 3.4) {
      swing += dt;
      if (swing >= 0.55) { swing = 0; hit.add((alt++ % 2) ? 'attackOver' : 'thrust'); }
    } else swing = 0;
    push += dt;
    if (dist < 8 && push >= 4) { push = 0; hit.add('push'); }
  };
  return input;
}

/** Everything countable, from the object that actually owns the count. */
function census(engine, world) {
  const geo = new Set(), mat = new Set(), tex = new Set();
  let nodes = 0, meshes = 0, tris = 0;
  engine.scene.traverse((o) => {
    nodes++;
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    if (o.geometry) {
      geo.add(o.geometry);
      const idx = o.geometry.index, pos = o.geometry.attributes?.position;
      const n = idx ? idx.count : (pos ? pos.count : 0);
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    }
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      mat.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) {
        if (m[k]) tex.add(m[k]);
      }
    }
  });

  const P = world.physics;
  /* Rapier's own counters, which is the point: our arrays are a mirror and a
   * mirror cannot show a handle we forgot to release. */
  let rbLen = -1, colLen = -1, jointLen = -1;
  try {
    rbLen = P.world?.bodies?.len?.() ?? -1;
    colLen = P.world?.colliders?.len?.() ?? -1;
    jointLen = P.world?.impulseJoints?.len?.() ?? -1;
  } catch { /* the sphere solver has none of these */ }

  /* The two silent ones. */
  let nan = 0, underground = 0, far = 0, orphanJoint = 0, deadInList = 0;
  const T = world.terrain;
  for (const b of P.bodies) {
    if (!finite3(b.position) || !finite3(b.velocity)) nan++;
    if (b.dead) deadInList++;
    if (T && typeof T.height === 'function' && finite3(b.position)) {
      const g = T.height(b.position.x, b.position.z);
      if (Number.isFinite(g) && b.position.y < g - 0.6) underground++;
      if (Math.hypot(b.position.x, b.position.z) > 600) far++;
    }
  }
  for (const j of (P.joints || [])) if (!j.joint) orphanJoint++;

  let corpseBodies = 0, corpseGhosts = 0, corpseInPhys = 0, pieces = 0;
  const live = new Set(world.enemies);
  for (const c of (world.corpses?.list || [])) {
    const a = c.e?.actor;
    if (!live.has(c.e)) corpseGhosts++;
    if (a?.bodies) {
      corpseBodies += a.bodies.size ?? a.bodies.length ?? 0;
      for (const b of a.bodies.values()) if (P.bodies.includes(b)) corpseInPhys++;
    }
    if (a?.pieces) pieces += a.pieces.length;
  }

  return {
    nodes, meshes, geometries: geo.size, materials: mat.size, textures: tex.size,
    tris: Math.round(tris),
    bodies: P.bodies.length, joints: (P.joints || []).length,
    statics: P.staticBoxes?.length ?? 0,
    byCollider: P._byCollider?.size ?? 0,
    rbLen, colLen, jointLen,
    enemies: world.enemies.length,
    alive: world.enemies.filter((e) => !e.dead).length,
    props: world.props.length, debris: world.debris.length,
    staticMeshes: world.statics.length, locks: world.locks.length,
    players: world.players.length,
    corpses: world.corpses?.list.length ?? 0, corpseBodies, corpseGhosts, corpseInPhys, pieces,
    sceneKids: engine.scene.children.length,
    settled: world.corpses?.settled ?? 0, retired: world.corpses?.retired ?? 0,
    overBudget: P.stats?.overBudget ?? 0,
    nan, underground, far, orphanJoint, deadInList,
    grind: world.bladeSolver?.progress?.size ?? 0,
    touched: world.bladeSolver?.touched?.size ?? 0,
    cooldown: world.bladeSolver?.cooldown?.size ?? 0,
    wave: world.director?.wave ?? 0,
    kills: world.kills ?? world.director?.killed ?? 0,
  };
}

const KEYS = null;
function line(tag, c) {
  const k = KEYS || Object.keys(c);
  return `${String(tag).padStart(6)}  ` + k.map((x) => `${x}=${c[x]}`).join(' ');
}

async function main() {
  const { world, engine } = await bootWorld({
    level: LEVEL,
    settings: { mode: MODE, level: LEVEL, quality: QUALITY, difficulty: 'knight' },
    runSeed: SEED,
  });
  world.director?.start?.(1);
  const input = hunterInput(world);

  const marks = [];
  const t0 = Date.now();
  let t = 0;
  marks.push({ t: 0, c: census(engine, world) });
  console.log(line(0, marks[0].c));
  const n = Math.round(SECONDS / STEP);
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    t += STEP;
    if (t >= (marks.length) * EVERY - 1e-9) {
      const c = census(engine, world);
      marks.push({ t: +t.toFixed(1), c });
      console.log(line(marks[marks.length - 1].t, c));
    }
  }

  const first = marks[1]?.c || marks[0].c, last = marks[marks.length - 1].c;
  console.log('\n── growth per 100 game-seconds, from the first mark to the last ──');
  const span = (marks[marks.length - 1].t - (marks[1]?.t ?? 0)) || 1;
  for (const k of Object.keys(last)) {
    const d = last[k] - first[k];
    if (!d) continue;
    console.log(`  ${k.padEnd(14)} ${String(first[k]).padStart(8)} → ${String(last[k]).padStart(8)}   ${(d / span * 100).toFixed(2)}/100s`);
  }
  console.log(`\nwall ${((Date.now() - t0) / 1000).toFixed(1)}s for ${t.toFixed(0)} game-seconds`);

  /* Who is still standing, when the field has gone quiet and the director is
   * waiting on a wave that will not clear. */
  console.log('\n── still on the field ──');
  for (const e of world.enemies) {
    console.log(`  ${e.type} ${e.dead ? 'DEAD' : 'alive'} hp=${(e.hp ?? 0).toFixed(0)} `
      + `at ${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)} `
      + `ground=${(world.terrain?.height?.(e.position.x, e.position.z) ?? NaN).toFixed(1)}`);
  }

  /* …and the other end of the session. */
  world.unload();
  const after = census(engine, world);
  console.log('\n── after unload ──');
  console.log(line('end', after));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
export { census, THREE };
