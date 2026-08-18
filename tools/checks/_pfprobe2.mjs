/* TEMPORARY diagnostic probe. The largest INDIVISIBLE unit of work in the
 * approach-time build, per phase. Each structure is fractured five times with a
 * deadline that expires on every look, so every slice is a minimal one; the
 * statistic kept per (structure, phase) is the MINIMUM over the five repeats of
 * that run's worst slice, which a stall can only inflate and never deflate. */
import * as THREE from 'three';
import { snapshotShared, restoreShared } from './_shared.mjs';

function stubEngine(THREE) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
}

const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

async function loadWorld(THREE, level) {
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'high' });
  await world.loadLevel(level);
  world.spawnPlayer?.();
  return world;
}


export async function run({ check }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  check('the largest indivisible unit, by phase', async () => {
    const shared = await snapshotShared();
    const world = await loadWorld(THREE, 'colosseum');
    const D = world.destruction;
    const { fractureJob } = await import('../../src/world/Destruction.js');
    try {
      const best = new Map();                     // phase -> [ms, id]
      const cellBest = [];
      for (const s of D.structures) {
        if (s.chunks || s.state === 'gone') continue;
        const whole = s._surfaceSamples();
        const bounds0 = s.local.clone();
        if (bounds0.isEmpty()) bounds0.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
        const runs = [];
        for (let rep = 0; rep < 5; rep++) {
          const job = fractureJob(bounds0.clone(), whole.samples, {
            cell: s.profile.cell, seed: s.seed * 131 + 7, maxCells: D.maxCellsPerPiece,
            matOf: (i) => whole.mats[i], normals: whole.normals, corners: whole.corners, triAt: whole.triAt });
          const w = new Map();
          let last = performance.now();
          const ob = () => { const t = performance.now(); const p = 'slice';
            if (!(w.get(p) >= t - last)) w.set(p, t - last); last = t; return true; };
          let guard = 0;
          while (!job.step(ob) && guard++ < 6000);
          runs.push(w);
        }
        const phases = new Set(); for (const w of runs) for (const k of w.keys()) phases.add(k);
        for (const p of phases) {
          const v = Math.min(...runs.map((w) => w.get(p) ?? 0));
          const cur = best.get(p);
          if (!cur || v > cur[0]) best.set(p, [v, s.id, whole.samples.length / 3]);
        }
        // and the geometry build, which shares the same budget and is not sliced
        const eager = fractureJob(bounds0.clone(), whole.samples, {
          cell: s.profile.cell, seed: s.seed * 131 + 7, maxCells: D.maxCellsPerPiece,
          matOf: (i) => whole.mats[i], normals: whole.normals, corners: whole.corners, triAt: whole.triAt });
        eager.step(() => false);
        s.chunks = eager.cells.map((cell, i) => ({ cell, centre: cell.centre, volume: cell.volume,
          hp: 1, state: 'ok', geo: null, hull: null, neighbours: [] }));
        let worstCell = 0;
        for (const c of s.chunks) {
          const reps = [];
          for (let r = 0; r < 3; r++) { c.geo = null; const t = performance.now(); s.prepareCell(c); reps.push(performance.now() - t); }
          worstCell = Math.max(worstCell, Math.min(...reps));
        }
        s.chunks = null;
        cellBest.push([worstCell, s.id]);
      }
      cellBest.sort((a, b) => b[0] - a[0]);
      const out = ['largest indivisible slice per phase, over all 46 structures (min of 5 repeats):'];
      for (const [p, v] of [...best.entries()].sort((a, b) => b[1][0] - a[1][0])) {
        out.push(`  ${v[0].toFixed(2)} ms  ${p.padEnd(14)} worst on ${v[1]} (${v[2]} samples)`);
      }
      out.push(`  ${cellBest[0][0].toFixed(2)} ms  prepareCell    worst on ${cellBest[0][1]} — one cell, unsliced, inside the same budget`);
      out.push(`budget is ${D.prepareBudgetMs} ms; a slice may overrun it by its own length`);
      return '\n' + out.join('\n');
    } finally { restoreShared(shared); }
  });
}
