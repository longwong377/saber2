/**
 * BATTLEFRONT BORZ — what a frame COSTS, in counts, at the worst moment.
 *
 * A day's worth of content landed with no price on any of it — jetpack plumes
 * and a held audio loop, blood that rays every rim vertex back onto the body,
 * B2 droids, cape columns, a forked lightning arc, artillery, smoke,
 * nameplates. This is the instrument that prices it, and every number it
 * prints is a COUNT and not a clock, for the reason HANDOFF §2.6 gives twice:
 * this box is shared, one frame through swiftshader takes seconds, and a
 * millisecond measured here is a measurement of whoever else is running. A
 * count is the same number on every machine and it is what a budget is made
 * of.
 *
 * WHAT IT COUNTS, and why each one is the number that matters:
 *
 *   mtxVisit  node-visits inside Object3D.updateMatrixWorld per frame. Not
 *             calls — VISITS — because `updateMatrixWorld(true)` on a rig root
 *             walks and re-multiplies every descendant, so one call and nine
 *             hundred matrix multiplies look identical from the call site.
 *             This is how you see a rig being posed three times over.
 *   drawn     what the particle system asks the GPU to run a vertex shader
 *             over. A dead particle is culled BY the vertex shader, so the
 *             cost of a pool used to be its capacity whether or not anything
 *             was alive in it: 19 800 instances a frame, permanently.
 *   live      how many of those are actually inside their life window. The
 *             gap between this and `drawn` is the waste.
 *   spawn/f   particle spawns per pool per frame, so an effect with no ceiling
 *             shows up as a spike against its own pool's capacity.
 *   clothLnk  cloth link-solves per frame — links x iterations over every
 *             garment being solved. `CARRY_ITERS` shows up here and nowhere
 *             else.
 *
 * WHAT IT FOUND, on geonosis in Command at `high`:
 *
 *                                    before        after
 *     matrix visits/frame, 12+1        7 996    4 889-5 107   (-38%)
 *     ...per body                        615        376-393
 *     particle instances drawn        19 800        295-1 798
 *     ...on an ordinary wave frame    19 800            661   (30x)
 *     ...at the worst moment          19 800          1 798   (11x)
 *
 * The two scenes are deliberately different in kind. CENSUS spawns twelve of
 * one archetype by hand with no director, because the director's body count
 * wanders by three or four between runs and a per-frame count compared against
 * another run's has to be over the same bodies. The rows after it are a real
 * escalating battle, where the point is the SHAPE of the worst moment rather
 * than a number you can difference.
 *
 * Powers are driven through the INPUT and not called directly (see `press`),
 * for HANDOFF §2.4's reason: `Player.update` builds the `ctx` these effects
 * read, and a probe that calls `forceLightning` with a hand-made context is
 * measuring its own object.
 *
 *   node --import ./tools/register.mjs tools/_framecost.mjs
 *     [--level=geonosis] [--mode=command] [--quality=high]
 *     [--wave=6] [--waves=2] [--type=trooper] [--census=0]
 */
import './dom-shim.mjs';
import * as THREE from 'three';

/* ── the counters, installed on three itself ─────────────────────────── */

const M = { visits: 0, calls: 0, forced: 0 };
{
  const proto = THREE.Object3D.prototype;
  const real = proto.updateMatrixWorld;
  /* Counted by REIMPLEMENTING the walk rather than by wrapping the recursive
   * call, because a wrapper counts the outermost call once and the recursion
   * through the real body not at all — which is the exact difference between
   * "one call" and "nine hundred matrix multiplies" that this probe exists to
   * show. Kept byte-faithful to three r169's own body; if that changes, the
   * counts move and the shape of the answer does not. */
  M.stacks = new Map();
  M.trace = false;
  proto.updateMatrixWorld = function (force) {
    M.calls++;
    if (force) M.forced++;
    if (M.trace) {
      const before = M.visits;
      walk(this, force);
      /* WHO ASKED, and how much of the graph it cost. A count with no call
       * site in it is a finding nobody can act on — the same reason
       * cloth-cost keeps the first offending stack for an over-capacity
       * burst. Off by default: an Error per call is far more expensive than
       * the walk it is measuring. */
      const frames = (new Error().stack || '').split('\n')
        .filter((l) => /src[\\/](game|world|engine|ui)/.test(l) && !/_framecost/.test(l))
        .slice(0, 2)
        .map((l) => l.trim().replace(/^at\s+/, '').replace(/.*\/src\//, '').replace(/\)$/, ''));
      const key = frames.join('  <-  ') || 'unknown';
      const rec = M.stacks.get(key) || { calls: 0, visits: 0 };
      rec.calls++; rec.visits += M.visits - before;
      M.stacks.set(key, rec);
      return;
    }
    walk(this, force);
  };
  function walk(o, force) {
    M.visits++;
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.matrixWorldNeedsUpdate || force) {
      if (o.matrixWorldAutoUpdate === true) {
        if (o.parent === null) o.matrixWorld.copy(o.matrix);
        else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      }
      o.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.matrixWorldAutoUpdate === true || force === true) walk(c, force);
    }
  }
  M.restore = () => { proto.updateMatrixWorld = real; };
}

/* ── the scene ───────────────────────────────────────────────────────── */

const argv = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? '1'];
}));

const LEVEL = argv.get('level') || 'geonosis';
const MODE = argv.get('mode') || 'command';
const QUALITY = argv.get('quality') || 'high';
const WAVES = Number(argv.get('waves') ?? 2);

/**
 * An input that can be told to press one action on one frame.
 *
 * Powers are driven through this and not called directly, for HANDOFF §2.4's
 * reason: `Player.update` builds the `ctx` these effects read — the foe list,
 * the rules, the particle system — and a probe that calls `forceLightning`
 * with a hand-made ctx is measuring its own object. Through the input it is
 * measuring the game.
 */
const press = new Set();
const idleInput = () => ({
  act: (a) => press.has(a), actHit: (a) => press.has(a), actDown: (a) => press.has(a),
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

const { initPhysics } = await import('../src/physics/Rapier.js');
await initPhysics();
const { stubEngine } = await import('./checks/_coop.mjs');
const { World } = await import('../src/game/World.js');
const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
const { DIFFICULTY } = await import('../src/game/Combat.js');
const { enemyRng } = await import('../src/game/Enemy.js');
enemyRng.seed(20260818);

const engine = await stubEngine();
const settings = { ...DEFAULT_SETTINGS, quality: QUALITY, mode: MODE };
const world = new World(engine, settings);
world.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.knight;
await world.loadLevel(LEVEL);
world.spawnPlayer({ name: 'Jedi', isLocal: true });

/* ── the particle instrument ─────────────────────────────────────────── */

const P = world.particles;
const POOLS = ['sparks', 'embers', 'plasma', 'smoke', 'dust', 'grit', 'water'];
const spawns = Object.fromEntries(POOLS.map((k) => [k, 0]));
for (const k of POOLS) {
  const pool = P[k];
  if (!pool) continue;
  const real = pool.spawn.bind(pool);
  pool.spawn = (...a) => { spawns[k]++; return real(...a); };
}

/** How many slots in a pool are inside their life window right now. */
function liveIn(pool) {
  let n = 0;
  const pa = pool.aParams.array, ex = pool.aExtra.array, t = pool.time;
  for (let i = 0; i < pool.max; i++) {
    const life = pa[i * 4];
    if (life <= 0) continue;
    const age = t - ex[i * 3 + 2];
    if (age >= 0 && age <= life) n++;
  }
  return n;
}

/** Every instance the particle system asks the GPU to run a vertex over. */
function instancesDrawn() {
  let n = 0;
  for (const k of POOLS) {
    const pool = P[k];
    if (!pool) continue;
    const g = pool.mesh.geometry;
    n += (g.instanceCount === undefined || g.instanceCount === Infinity) ? pool.max : g.instanceCount;
  }
  const d = P.decals?.mesh?.geometry;
  if (d) n += (d.instanceCount === undefined || d.instanceCount === Infinity) ? P.decals.max : d.instanceCount;
  return n;
}

/* ── the cloth instrument ────────────────────────────────────────────── */

/** Every cloth body hanging off a character, however it is reached. */
function garments(owner) {
  const found = [];
  const walk = (c) => {
    if (!c || typeof c !== 'object' || found.includes(c)) return;
    if (c.pos && c.links) found.push(c);
    for (const k of ['sash', 'outer', 'inner']) if (c[k] && c[k] !== c) walk(c[k]);
    for (const arr of ['parts', 'panels']) if (Array.isArray(c[arr])) c[arr].forEach(walk);
  };
  walk(owner.cloak); walk(owner.skirt);
  return found;
}

const clothTick = { links: 0, solved: 0, carried: 0 };
function instrumentCloth(owner) {
  for (const c of garments(owner)) {
    if (c.__probed) continue;
    c.__probed = true;
    const real = c.update.bind(c);
    Object.defineProperty(c, 'update', {
      value: (...a) => {
        if (c.enabled && c.initialised && c.anchorFn) {
          const iters = c.iterations + (c._carried ? 6 : 0);
          clothTick.links += c.links.length * iters;
          clothTick.solved++;
          if (c._carried) clothTick.carried++;
        }
        return real(...a);
      },
      configurable: true, writable: true,
    });
  }
}

/* ── run ─────────────────────────────────────────────────────────────── */

const input = idleInput();
const rows = [];
let frame = 0;

function stepAndSample(label, n = 1) {
  const before = { ...spawns };
  const m0 = { ...M };
  clothTick.links = 0; clothTick.solved = 0; clothTick.carried = 0;
  for (let i = 0; i < n; i++) { world.update(1 / 60, input); frame++; }
  instrumentCloth(world.player);
  for (const e of world.enemies) instrumentCloth(e);
  const live = Object.fromEntries(POOLS.map((k) => [k, P[k] ? liveIn(P[k]) : 0]));
  const row = {
    label,
    frames: n,
    enemies: world.enemies.filter((e) => !e.dead).length,
    visits: (M.visits - m0.visits) / n,
    calls: (M.calls - m0.calls) / n,
    forced: (M.forced - m0.forced) / n,
    spawn: Object.fromEntries(POOLS.map((k) => [k, (spawns[k] - before[k]) / n])),
    live,
    liveTotal: Object.values(live).reduce((a, b) => a + b, 0),
    instances: instancesDrawn(),
    clothLinks: clothTick.links / n,
    clothBodies: clothTick.solved / n,
    clothCarried: clothTick.carried / n,
  };
  rows.push(row);
  return row;
}

/**
 * A FIXED FIELD, FIRST — because the director's body count wanders by three or
 * four between runs and a per-frame count compared against another run's has
 * to be over the same bodies. Twelve of one archetype, hand-placed, no
 * director: the same skeletons in the same places every time.
 */
if (argv.get('census') !== '0') {
  const c = world.player.position;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = c.x + Math.cos(a) * 9, z = c.z + Math.sin(a) * 9;
    world.spawnEnemy(argv.get('type') || 'trooper', new THREE.Vector3(x, world.terrain.height(x, z), z));
  }
  for (let i = 0; i < 20; i++) world.update(1 / 60, input);
  const cen = stepAndSample('CENSUS: 12 hand-placed bodies + player', 30);
  console.log(`\nCENSUS  ${cen.visits.toFixed(0)} matrix node-visits/frame over `
    + `${cen.enemies} bodies + the player = ${(cen.visits / (cen.enemies + 1)).toFixed(0)} each; `
    + `${cen.calls.toFixed(0)} calls/frame\n`);
  for (const e of [...world.enemies]) e.dead = true;
  for (let i = 0; i < 90; i++) world.update(1 / 60, input);
}

// settle
stepAndSample('boot', 8);

// let a wave build. `main.js` calls `director.start(n)` on every deploy and
// nothing else does, so a probe that only steps the world fights nobody.
world.director?.start?.(Number(argv.get('wave') ?? 6));
for (let w = 0; w < WAVES; w++) {
  for (let i = 0; i < 90; i++) world.update(1 / 60, input);
}
const quiet = stepAndSample('wave, nothing firing', 30);

/* ── the worst moment ────────────────────────────────────────────────── */

const p = world.player;
const ctx = world._ctx ?? world;

// smoke, then a barrage into it, then lightning down the line
const S = p.stratagems;
let stratOk = false;
if (S) {
  const site = new THREE.Vector3().copy(p.position).addScaledVector(p.aimDir ?? new THREE.Vector3(0, 0, 1), 14);
  site.y = world.terrain.height(site.x, site.z);
  S.smoke(world._fxctx ?? world.ctx ?? world, site, 8.5, 11);
  stratOk = true;
}
const smokeFrame = stepAndSample('the frame a smoke screen lands', 1);
const afterSmoke = stepAndSample('one second later, smoke still up', 60);

let barrageFrame = null;
if (S) {
  const site = new THREE.Vector3().copy(p.position).addScaledVector(p.aimDir ?? new THREE.Vector3(0, 0, 1), 14);
  site.y = world.terrain.height(site.x, site.z);
  const table = (await import('../src/game/Stratagems.js')).STRATAGEMS;
  const barrage = table.find((s) => s.id === 'barrage');
  barrage.fire(world.ctx ?? world, site, S);
  barrageFrame = stepAndSample('a barrage landing in that smoke', 60);
}

// lightning, straight down the densest line of bodies
let boltFrame = null;
if (p.forceLightning) {
  p.boonMods.lightning = true;
  p.force = 999; p.maxForce = 999; p.cooldowns.lightning = 0;
  // stand behind the thickest knot of bodies and point through it
  let best = null, bestN = -1;
  for (const e of world.enemies) {
    if (e.dead) continue;
    let n = 0;
    for (const o of world.enemies) if (!o.dead && o.position.distanceTo(e.position) < 6.5) n++;
    if (n > bestN) { bestN = n; best = e; }
  }
  if (best) {
    const back = new THREE.Vector3().subVectors(best.position, p.position).setY(0).normalize();
    p.position.copy(best.position).addScaledVector(back, -6);
    p.position.y = world.terrain.height(p.position.x, p.position.z);
    p.aimDir.copy(back);
    if (p.camera) { p.camera.yaw = Math.atan2(back.x, back.z); p.camera.pitch = 0; }
    press.add('lightning');
    boltFrame = stepAndSample('the frame force lightning chains', 1);
    press.delete('lightning');
    console.log(`  [lightning] aimed through a knot of ${bestN}; `
      + `${boltFrame.spawn.sparks.toFixed(0)} sparks that frame`);
  }
}

/* ── WHO IS WALKING THE GRAPH ────────────────────────────────────────── */

/* One traced frame, at the end, with the whole field standing. Traced rather
 * than sampled because the question is not "how long" but "how many times, and
 * from where", and that is exact. */
M.trace = true;
M.stacks.clear();
const t0 = M.visits;
world.update(1 / 60, input);
M.trace = false;
const traced = [...M.stacks.entries()].sort((a, b) => b[1].visits - a[1].visits);
console.log(`\nONE FRAME'S MATRIX WALK — ${M.visits - t0} node visits, `
  + `${world.enemies.filter((e) => !e.dead).length} bodies standing\n`);
console.log('  visits    calls   caller');
for (const [k, v] of traced.slice(0, 14)) {
  console.log(`  ${String(v.visits).padStart(6)}   ${String(v.calls).padStart(6)}   ${k}`);
}

/* ── report ──────────────────────────────────────────────────────────── */

const caps = Object.fromEntries(POOLS.map((k) => [k, P[k] ? P[k].max : 0]));
const capTotal = Object.values(caps).reduce((a, b) => a + b, 0);

console.log(`\n${LEVEL} · ${MODE} · quality ${QUALITY} · ${frame} frames stepped\n`);
console.log('pool capacities:', POOLS.map((k) => `${k} ${caps[k]}`).join('  '), `= ${capTotal}`);
console.log('');
const pad = (s, n) => String(s).padStart(n);
console.log('moment'.padEnd(34) + pad('foes', 5) + pad('mtxVisit', 10) + pad('mtxCall', 9)
  + pad('clothLnk', 10) + pad('cloths', 8) + pad('carried', 9) + pad('spawn/f', 9)
  + pad('live', 7) + pad('drawn', 8));
for (const r of rows) {
  const sp = Object.values(r.spawn).reduce((a, b) => a + b, 0);
  console.log(r.label.padEnd(34) + pad(r.enemies, 5) + pad(r.visits.toFixed(0), 10)
    + pad(r.calls.toFixed(0), 9) + pad(r.clothLinks.toFixed(0), 10)
    + pad(r.clothBodies.toFixed(1), 8) + pad(r.clothCarried.toFixed(1), 9)
    + pad(sp.toFixed(1), 9) + pad(r.liveTotal, 7) + pad(r.instances, 8));
}
console.log('\nper-pool, at each moment (spawn/frame → live):');
for (const r of rows) {
  console.log('  ' + r.label.padEnd(34)
    + POOLS.map((k) => `${k} ${r.spawn[k].toFixed(1)}→${r.live[k]}`).join('  '));
}
console.log('');
if (!stratOk) console.log('(no stratagems on this player — the barrage/smoke rows are absent)');
M.restore();
world.unload();
world.dispose?.();
