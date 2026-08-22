/**
 * BATTLEFRONT BORZ — WHERE THE FRAME GOES, in CPU milliseconds, on a box that
 * is not quiet.
 *
 * ── WHY THIS EXISTS AND WHY IT DOES NOT USE `performance.now()` ─────────
 *
 * Every timing instrument in this tree measures wall clock, and HANDOFF §2.6
 * says twice what that is worth here: the box is shared, and the moment a peer
 * lane starts a suite the same work reads two to sixty times longer. That is
 * not a small correction to argue about — measured on THIS box while eleven
 * peer node processes were live, one fixed 200 000-iteration arithmetic loop
 * read as follows, alternate samples:
 *
 *     wall ms  0.441  0.456  0.431  0.471  28.551  0.457  0.416  …  24.881
 *     cpu  ms  0.441  0.453  0.428  0.467   0.559  0.454  0.416  …   0.443
 *
 * The wall column says the work got 60× more expensive. It did not; the process
 * was descheduled. `process.cpuUsage()` counts the time this process was ON a
 * core, so it is very nearly flat across the same samples — the residual (0.44
 * → 0.56 on the worst one) is cache pressure, which is real and is the honest
 * remaining error bar on everything below.
 *
 * So a full-gate figure like "19 enemies' garments cost 6.43 ms a frame" is not
 * a fact about the game until it has been taken this way. Reading it off a
 * loaded box is the same class of mistake as §2.6's "90 frames is 1.5 seconds".
 *
 * ── HOW IT SPLITS THE FRAME ────────────────────────────────────────────
 *
 * `process.cpuUsage()` costs ~3.7 µs a call — too expensive to put around every
 * one of ~220 per-body calls a frame — and `process.hrtime.bigint()` costs
 * ~0.5 µs but is wall clock again. So the two are combined:
 *
 *   · TWO `cpuUsage()` reads a frame, around `world.update`, give the frame's
 *     true CPU cost. That number is contention-proof and it is the one every
 *     row is denominated in.
 *   · The SPLIT between subsystems is taken in `hrtime` and used as a SHARE.
 *     A frame's descheduling lands wherever the scheduler puts it, so a share
 *     is noisy per frame — but it is unbiased across a few hundred of them,
 *     which is why this runs 400 and reports the mean.
 *
 * Each row is therefore `share_of_wall × cpu_ms_of_frame`, summed over frames,
 * and the rows add up to the frame by construction. Wall and CPU totals are
 * both printed so the contention factor is visible rather than assumed.
 *
 * Nesting is handled with a stack: a row is EXCLUSIVE of its children, so
 * `enemy think` does not contain `animation` and `animation` does not contain
 * `cloth`. `residual` is whatever `world.update` spent outside every probe —
 * props, doors, debris, the frame context, the net tick — and it is printed
 * rather than hidden so the ledger cannot silently stop adding up.
 *
 * ── THE POPULATION ─────────────────────────────────────────────────────
 *
 * At the numbers `theline` actually fields, not five enemies. `MODES.theline`'s
 * own note claims "32 to 37 hostiles standing twenty seconds in on every
 * ground" against a roster of ten; this boots that mode, at a seed, on a real
 * ground, and PRINTS what it got rather than asserting the claim (§2.4). The
 * player is `_flagship.mjs`'s `dutyInput` and it is TICKED every frame — see
 * §2.5c, which cost four benches in one afternoon.
 *
 *   node --import ./tools/register.mjs tools/_ledger.mjs
 *     [--seed 7] [--level geonosis] [--mode theline] [--quality high]
 *     [--warm 45] [--frames 400] [--json .audit/ledger.json]
 *     [--prof .audit/ledger.cpuprofile]
 *   node --import ./tools/register.mjs tools/_ledger.mjs --top .audit/ledger.cpuprofile [--n 30]
 *
 * `--prof` starts V8's sampling profiler around the MEASURED frames only, not
 * around the warm-up. That distinction is the whole reason it is a flag here
 * rather than `node --cpu-prof`: a deploy's first second builds colliders and
 * bakes merged skins, and a profile that contains it names the loader. §2.7b's
 * runaway `sparkBurst` was found by a profile in one pass after six sessions of
 * guessing, so this is the first thing to reach for and not the last.
 */
import './dom-shim.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(flag('seed', '7'));
const LEVEL = flag('level', 'geonosis');
const MODE = flag('mode', 'theline');
const QUALITY = flag('quality', 'high');
const WARM = Number(flag('warm', '45'));
const FRAMES = Number(flag('frames', '400'));
const JSON_OUT = flag('json', null);
const PROF_OUT = flag('prof', null);
const TOP = flag('top', null);
const STEP = 1 / 30;

/**
 * `--top` READS A PROFILE AND STOPS. Nothing below this line runs, which is the
 * point: reading a 40 MB profile does not need a World, and a reader that boots
 * one takes two minutes to answer a question about a file.
 *
 * Self time, not total: total time up a stack tells you `world.update` is 100%
 * of the frame, which is true and useless. The row that names a fix is the one
 * the samples actually LANDED in.
 */
if (TOP) {
  const { readFileSync } = await import('node:fs');
  const p = JSON.parse(readFileSync(TOP, 'utf8'));
  const by = new Map();
  const node = new Map(p.nodes.map((n) => [n.id, n]));
  let total = 0;
  for (let i = 1; i < p.timeDeltas.length; i++) {
    const n = node.get(p.samples[i]);
    if (!n) continue;
    const d = p.timeDeltas[i] / 1000;              // µs → ms
    total += d;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'}  ${(f.url || '').split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
    by.set(key, (by.get(key) ?? 0) + d);
  }
  const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, Number(flag('n', '30')));
  console.log(`\n${TOP} — ${total.toFixed(0)} ms of samples, self time by function\n`);
  for (const [k, v] of rows) console.log(`  ${(100 * v / total).toFixed(2).padStart(6)}%  ${v.toFixed(1).padStart(9)} ms  ${k}`);
  console.log('');
  process.exit(0);
}

const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { enemyRng } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');


/* ══ the meter ═══════════════════════════════════════════════════════════ */

const hr = process.hrtime.bigint;
const NS = 1e-6;                                   // ns → ms

/** inclusive[name] and childNs[name] in nanoseconds of WALL, per frame. */
const incl = new Map();
const kids = new Map();
const calls = new Map();
const stack = [];
let metering = false;

function enter(name) {
  if (!metering) return -1n;
  stack.push({ name, t: hr() });
  return 0n;
}
function leave(tokenName) {
  if (!metering) return;
  const top = stack.pop();
  if (!top || top.name !== tokenName) return;        // re-entrancy guard
  const d = hr() - top.t;
  incl.set(top.name, (incl.get(top.name) ?? 0n) + d);
  calls.set(top.name, (calls.get(top.name) ?? 0) + 1);
  const parent = stack[stack.length - 1];
  if (parent) kids.set(parent.name, (kids.get(parent.name) ?? 0n) + d);
}

/** Wrap one method of a prototype or object. Idempotent per (target, key). */
const wrapped = new WeakMap();
function meter(target, key, name) {
  if (!target) return false;
  const fn = target[key];
  if (typeof fn !== 'function') return false;
  let seen = wrapped.get(target);
  if (!seen) wrapped.set(target, seen = new Set());
  if (seen.has(key)) return true;
  seen.add(key);
  target[key] = function (...a) {
    enter(name);
    try { return fn.apply(this, a); } finally { leave(name); }
  };
  return true;
}

/* ══ probes, part one — the PROTOTYPES, before anything is built ═════════ */

/**
 * BEFORE `bootWorld`, and that ordering is load-bearing.
 *
 * `attachCloak` and `attachSkirt` each do `const _update = cape.update.bind(cape)`
 * at BUILD time and then replace `cape.update` with a wrapper that calls the
 * bound copy. A prototype patched after a garment is built is therefore invisible
 * to that garment: the wrapper holds a reference to the ORIGINAL method and the
 * cloth solve reads as zero. That is exactly HANDOFF §2.3's "a missing thing
 * answered with a plausible default" — an empty row, not an error.
 */
const { Enemy } = await import('../src/game/Enemy.js');
const Rig = await import('../src/game/Rig.js');
const { Cloak } = await import('../src/game/Cloth.js');

/**
 * THE POSE SOLVE, SPLIT BY HOW FAR AWAY THE BODY IS.
 *
 * `animation` is the second-biggest row and the whole question about it is
 * whether it is being spent on bodies anybody can see. A body past `L3_AT` is
 * drawn by an InstancedMesh from its position and facing alone — Cohorts.js
 * says so in its own header, "what is dropped is the gait" — so a gait solved
 * for one of those is work no pixel reads. This is the number that says whether
 * that is worth fixing, and it is taken rather than assumed.
 */
const byLod = [0, 0, 0, 0];
const nLod = [0, 0, 0, 0];
{
  const real = Enemy.prototype._pose;
  Enemy.prototype._pose = function (...a) {
    if (!metering) return real.apply(this, a);
    const t = hr();
    enter('animation');
    try { return real.apply(this, a); } finally {
      leave('animation');
      const l = Math.min(3, Math.max(0, this.lod | 0));
      byLod[l] += Number(hr() - t); nLod[l]++;
    }
  };
  wrapped.set(Enemy.prototype, new Set(['_pose']));
}

meter(Enemy.prototype, 'update', 'enemy other');
meter(Enemy.prototype, '_think', 'enemy think');
meter(Enemy.prototype, '_poseWalker', 'animation');
meter(Rig.BipedAnimator?.prototype, 'update', 'animation');
meter(Cloak.prototype, 'update', 'cloth');

/* ══ boot ════════════════════════════════════════════════════════════════ */

/* All THREE module streams, exactly as _linehold.mjs phases them — HANDOFF
 * §2.5b. A ledger does not depend on the draw the way a survivor count does,
 * but the POPULATION does, and the population is the headline. */
enemyRng.seed((20260821 ^ Math.imul(SEED, 2654435761)) >>> 0);
seedWaves((20260821 ^ Math.imul(SEED, 40503)) >>> 0);
seedWorld((20260821 ^ Math.imul(SEED, 2246822519)) >>> 0);

const { world } = await H.bootWorld({
  level: LEVEL,
  settings: { mode: MODE, level: LEVEL, order: 'jedi', quality: QUALITY },
  runSeed: SEED,
});
if (world.command) world.command.onMuster = () => {};
world.command?.start?.(1);

const input = dutyInput(world);

/* ── warm up to a real battlefield. No metering yet: the first frames of a
 * deploy build colliders, bake merged skins and light the field, and a mean
 * that includes them is a mean about loading rather than about playing. */
let t = 0;
for (let i = 0; i < Math.round(WARM / STEP); i++) {
  if (world.player) world.player.hp = world.player.maxHp;
  input.tick?.(STEP);
  world.update(STEP, input);
  t += STEP;
}

/* ══ probes, part two — the live world ═══════════════════════════════════ */

/* The garment wrappers (`cloak`, `skirt`, `cape`) are BUILT OBJECTS and not
 * class instances — `refreshColliders` is a closure on each one — so they can
 * only be metered per body. Re-swept each frame because bodies spawn. */
const swept = new WeakSet();
function sweepGarments() {
  for (const e of world.enemies) {
    if (swept.has(e)) continue;
    swept.add(e);
    for (const k of ['cloak', 'skirt']) {
      const g = e[k];
      if (!g) continue;
      meter(g, 'refreshColliders', 'cloth');
      meter(g, 'update', 'cloth');
    }
  }
}

/* Once-a-frame systems, on the live objects World.update calls. `command` and
 * `director` are the SAME object when the mode leads an army, and `meter` is
 * idempotent per (target, key), so that is one row and not two. */
function meterWorld() {
  meter(world, '_resolveBlades', 'blades');
  meter(world, '_updateCatch', 'residual');
  meter(world.physics, 'step', 'physics');
  meter(world.bolts, 'update', 'bolts');
  meter(world.particles, 'update', 'particles');
  meter(world.corpses, 'update', 'corpses');
  meter(world.lightning, 'update', 'vfx');
  meter(world.grenades, 'update', 'vfx');
  meter(world.support, 'update', 'vfx');
  meter(world.terrain, 'flush', 'terrain');
  meter(world.grass, 'update', 'terrain');
  meter(world.water, 'update', 'terrain');
  meter(world.atmosphere, 'update', 'terrain');
  meter(world.director, 'update', 'director');
  meter(world.command, 'update', 'director');
  meter(world.extraction, 'update', 'director');
  for (const p of world.players) meter(p, 'update', 'player');
}
meterWorld();
sweepGarments();

/* ══ measure ═════════════════════════════════════════════════════════════ */

const ROWS = ['player', 'enemy think', 'animation', 'cloth', 'enemy other',
  'blades', 'bolts', 'physics', 'particles', 'vfx', 'terrain', 'corpses',
  'director', 'residual'];

const sum = new Map(ROWS.map((r) => [r, 0]));       // CPU ms, total over frames
const callN = new Map(ROWS.map((r) => [r, 0]));
let cpuTotal = 0, wallTotal = 0, worst = 0, worstWall = 0;
const pop = { enemies: 0, alive: 0, clothOn: 0, lod0: 0, lod1: 0, lod2: 0, lod3: 0, cohort: 0,
  merged: 0, garments: 0, bolts: 0, corpses: 0, samples: 0 };

const cpuMs = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };

let profSession = null;
if (PROF_OUT) {
  const { Session } = await import('node:inspector/promises');
  profSession = new Session();
  profSession.connect();
  await profSession.post('Profiler.enable');
  await profSession.post('Profiler.setSamplingInterval', { interval: 200 });
  await profSession.post('Profiler.start');
}

for (let f = 0; f < FRAMES; f++) {
  if (world.player) world.player.hp = world.player.maxHp;
  sweepGarments();
  meterWorld();
  incl.clear(); kids.clear(); calls.clear(); stack.length = 0;

  input.tick?.(STEP);
  const c0 = cpuMs(); const w0 = hr();
  metering = true;
  world.update(STEP, input);
  metering = false;
  const wallNs = Number(hr() - w0);
  const cpu = cpuMs() - c0;
  t += STEP;

  cpuTotal += cpu; wallTotal += wallNs * NS;
  if (cpu > worst) worst = cpu;
  if (wallNs * NS > worstWall) worstWall = wallNs * NS;

  /* SHARES, not milliseconds. The split is wall and the frame is CPU; a row is
   * its own share of the frame's wall time spent at the frame's CPU cost. When
   * the process is not descheduled the two are the same number. */
  let named = 0;
  const excl = new Map();
  for (const r of ROWS) {
    const e = Number((incl.get(r) ?? 0n) - (kids.get(r) ?? 0n));
    excl.set(r, e > 0 ? e : 0);
    named += e > 0 ? e : 0;
    callN.set(r, callN.get(r) + (calls.get(r) ?? 0));
  }
  const rest = Math.max(0, wallNs - named);
  excl.set('residual', excl.get('residual') + rest);
  const denom = named + rest;
  if (denom > 0) for (const r of ROWS) sum.set(r, sum.get(r) + (excl.get(r) / denom) * cpu);

  const alive = world.enemies.filter((e) => !e.dead);
  pop.enemies += world.enemies.length;
  pop.alive += alive.length;
  pop.clothOn += alive.filter((e) => e.clothOn).length;
  pop.lod0 += alive.filter((e) => e.lod === 0).length;
  pop.lod1 += alive.filter((e) => e.lod === 1).length;
  pop.lod2 += alive.filter((e) => e.lod === 2).length;
  pop.lod3 += alive.filter((e) => e.lod === 3).length;
  pop.cohort += alive.filter((e) => e._l3).length;
  pop.merged += alive.filter((e) => e._l2).length;
  pop.garments += alive.reduce((n, e) => n + (e.cloak ? 1 : 0) + (e.skirt ? 1 : 0), 0);
  pop.bolts += world.bolts?.bolts?.reduce((n, b) => n + (b.active ? 1 : 0), 0) ?? 0;
  pop.corpses += world.corpses?.list?.length ?? 0;
  pop.samples++;
}

if (profSession) {
  const { profile } = await profSession.post('Profiler.stop');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(PROF_OUT), { recursive: true });
  writeFileSync(PROF_OUT, JSON.stringify(profile));
  profSession.disconnect();
}

/* ══ report ══════════════════════════════════════════════════════════════ */

const per = (x) => x / FRAMES;
const N = pop.samples || 1;
const rows = ROWS.map((r) => ({ row: r, ms: per(sum.get(r)), calls: callN.get(r) / FRAMES }))
  .sort((a, b) => b.ms - a.ms);
const frameMs = per(cpuTotal);

console.log('');
console.log(`${MODE} · ${LEVEL} · seed ${SEED} · quality ${QUALITY} · ${FRAMES} frames after ${WARM}s warm-up`);
console.log(`population: ${(pop.alive / N).toFixed(1)} enemies alive of ${(pop.enemies / N).toFixed(1)} bodies `
  + `· lod 0/1/2/3 = ${(pop.lod0 / N).toFixed(1)}/${(pop.lod1 / N).toFixed(1)}/${(pop.lod2 / N).toFixed(1)}/${(pop.lod3 / N).toFixed(1)} `
  + `· ${(pop.merged / N).toFixed(1)} merged, ${(pop.cohort / N).toFixed(1)} instanced`);
/**
 * WHY THE PHYSICS ROW IS THE SIZE IT IS.
 *
 * `Corpses` freezes a ragdoll when it has been under SETTLE_SPEED for
 * SETTLE_HOLD, and freezing is what takes its ~19 rigid bodies out of the
 * solver. So "how many corpses are held" is not the question — "how many of
 * them are still being SIMULATED" is, and the two are only the same number if
 * every body eventually stops moving. This prints both, plus the speed each
 * unsettled one is actually carrying, so the answer is measured rather than
 * assumed either way.
 */
const corpses = world.corpses?.list ?? [];
const rowsC = [];
let unsettled = 0, oldest = 0, ragBodies = 0;
for (const c of corpses) {
  const a = c.e?.actor;
  if (a?.bodies && !a.slept) ragBodies += a.bodies.size ?? 0;
  if (c.settled) continue;
  unsettled++;
  oldest = Math.max(oldest, c.t);
  let m = 0;
  if (a?.bodies) for (const b of a.bodies.values()) {
    const v = b.velocity; if (!v) continue;
    m = Math.max(m, Math.hypot(v.x, v.y, v.z));
  }
  const pos = c.e?.position;
  const g = pos && world.terrain?.height ? world.terrain.height(pos.x, pos.z) : NaN;
  rowsC.push({ t: c.t, v: m, still: c.still,
    above: pos && Number.isFinite(g) ? pos.y - g : NaN,
    away: pos && world.player ? pos.distanceTo(world.player.position) : NaN });
}
rowsC.sort((a, b) => a.v - b.v);
const speeds = rowsC.map((r) => r.v);
const med = speeds.length ? speeds[speeds.length >> 1] : 0;
const ps = world.physics?.stats ?? {};
console.log(`physics:    ${ps.bodies ?? '-'} rigid bodies (${ps.awake ?? '-'} awake), ${ps.colliders ?? '-'} colliders, `
  + `${ps.joints ?? '-'} joints, ${ps.substeps ?? '-'} substep(s) · corpses held ${world.corpses?.list?.length ?? '-'} `
  + `(${world.corpses?.settled ?? '-'} settled, ${world.corpses?.retired ?? '-'} retired, budget ${world.corpses?.budget ?? '-'})`);
console.log(`            ${unsettled} of ${corpses.length} corpses NOT settled — median ragdoll speed `
  + `${med.toFixed(3)} m/s against a settle threshold of 0.05, oldest ${oldest.toFixed(1)} s down, `
  + `${ragBodies} rigid bodies still in the solver for the dead`);
if (rowsC.length) {
  console.log('              age s   speed m/s   still s   above ground m   from player m');
  for (const r of rowsC) {
    console.log(`            ${r.t.toFixed(1).padStart(7)}  ${r.v.toFixed(2).padStart(10)}  `
      + `${r.still.toFixed(2).padStart(8)}  ${(Number.isFinite(r.above) ? r.above.toFixed(2) : '  n/a').padStart(15)}  `
      + `${(Number.isFinite(r.away) ? r.away.toFixed(1) : ' n/a').padStart(14)}`);
  }
}
{
  const bi = world.physics?.boxIndex;
  const nb = world.physics?.staticBoxes?.length ?? 0;
  if (bi && bi.queries) {
    console.log(`            ${nb} static boxes · broad phase touched ${(bi.tested / bi.queries).toFixed(1)} `
      + `a query against ${(bi.linear / bi.queries).toFixed(1)} for the exhaustive sweep `
      + `(${(bi.linear / Math.max(1, bi.tested)).toFixed(1)}x), ${bi.rebuilds} rebuilds, ${bi.oversized.length} oversized`);
  } else console.log(`            ${nb} static boxes · no broad phase on this physics world`);
}
console.log(`            ${(pop.clothOn / N).toFixed(1)} inside the cloth cut of ${world.clothCut} m, `
  + `${(pop.garments / N).toFixed(1)} enemy garments · ${(pop.bolts / N).toFixed(1)} bolts, `
  + `${(pop.corpses / N).toFixed(1)} corpses · roster ${world.command?.roster?.strength ?? '-'}`);
console.log('');
console.log('  subsystem        ms CPU/frame    share   calls/frame');
for (const r of rows) {
  console.log(`  ${r.row.padEnd(14)} ${r.ms.toFixed(3).padStart(10)}   ${(100 * r.ms / (frameMs || 1)).toFixed(1).padStart(6)}%   `
    + `${r.calls.toFixed(1).padStart(8)}`);
}
console.log(`  ${'—'.repeat(14)} ${'—'.repeat(10)}`);
console.log(`  ${'FRAME'.padEnd(14)} ${frameMs.toFixed(3).padStart(10)}   ${'100.0'.padStart(6)}%`);
console.log('');
{
  const tot = byLod.reduce((a, b) => a + b, 0) || 1;
  const animMs = sum.get('animation') / FRAMES;
  console.log('  the pose solve by LOD band (share of the `animation` row):');
  console.log('    lod   what draws it                       solves/frame    ms CPU/frame');
  const what = ['0  its own meshes, full detail', '1  its own meshes, decoration culled',
    '2  a merged skin, one draw a material', '3  an InstancedMesh — the gait is NOT drawn'];
  for (let l = 0; l < 4; l++) {
    console.log(`    ${what[l].padEnd(38)} ${(nLod[l] / FRAMES).toFixed(1).padStart(8)}   `
      + `${(animMs * byLod[l] / tot).toFixed(3).padStart(13)}`);
  }
  console.log('');
}
console.log(`  frame wall ${per(wallTotal).toFixed(3)} ms · frame CPU ${frameMs.toFixed(3)} ms `
  + `· contention ×${(wallTotal / (cpuTotal || 1)).toFixed(2)} `
  + `(worst frame: ${worstWall.toFixed(1)} ms wall, ${worst.toFixed(1)} ms CPU)`);
console.log(`  loadavg ${(await import('node:os')).loadavg().map((x) => x.toFixed(1)).join(' ')} on ${(await import('node:os')).cpus().length} cores`);
console.log('');

if (PROF_OUT) console.log(`  wrote ${PROF_OUT} — self-time by function: tools/_ledger.mjs --top`);

if (JSON_OUT) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({
    mode: MODE, level: LEVEL, seed: SEED, quality: QUALITY, frames: FRAMES, warm: WARM,
    frameCpuMs: frameMs, frameWallMs: per(wallTotal), contention: wallTotal / (cpuTotal || 1),
    rows: Object.fromEntries(rows.map((r) => [r.row, +r.ms.toFixed(4)])),
    population: Object.fromEntries(Object.entries(pop).map(([k, v]) => [k, +(v / N).toFixed(2)])),
    clothCut: world.clothCut,
    physics: { ...(world.physics?.stats ?? {}) },
    poseByLod: byLod.map((v, i) => ({ lod: i, solvesPerFrame: +(nLod[i] / FRAMES).toFixed(2),
      ms: +((sum.get('animation') / FRAMES) * v / (byLod.reduce((a, b) => a + b, 0) || 1)).toFixed(4) })),
  }, null, 2) + '\n');
  console.log(`  wrote ${JSON_OUT}`);
}

world.unload();
