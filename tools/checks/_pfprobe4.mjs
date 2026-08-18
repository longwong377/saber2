import * as THREE from 'three';
import { snapshotShared, restoreShared } from './_shared.mjs';
export async function run({ check }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();
  check('survey vs splitCell', async () => {
    const shared = await snapshotShared();
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { fractureJob } = await import('../../src/world/Destruction.js');
    const eng = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(),
      sunDir: new THREE.Vector3(0, 1, 0),
      renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
      profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
      applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {}, setFocus() {},
      setRadial() {}, setGrain() {}, setBloom() {}, setSense() {}, setQuality() {},
      setResolutionScale() {}, render() {} };
    eng.sun.shadow.camera.updateProjectionMatrix();
    const world = new World(eng, { ...DEFAULT_SETTINGS, quality: 'high' });
    await world.loadLevel('colosseum');
    const D = world.destruction;
    try {
      const rows = [];
      for (const s of D.structures) {
        if (s.chunks || s.state === 'gone') continue;
        const whole = s._surfaceSamples();
        const b0 = s.local.clone();
        if (b0.isEmpty()) b0.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
        const reps = [];
        for (let r = 0; r < 5; r++) {
          globalThis.__pfT = { survey: 0, split: 0, nSurvey: 0, nSplit: 0 };
          const job = fractureJob(b0.clone(), whole.samples, { cell: s.profile.cell,
            seed: s.seed * 131 + 7, maxCells: D.maxCellsPerPiece, matOf: (i) => whole.mats[i],
            normals: whole.normals, corners: whole.corners, triAt: whole.triAt });
          let g = 0; while (!job.step(() => true) && g++ < 6000);
          reps.push(globalThis.__pfT);
        }
        const mn = (k) => Math.min(...reps.map(x => x[k]));
        rows.push([mn('survey'), mn('split'), reps[0].nSurvey, reps[0].nSplit, s.id, whole.samples.length / 3]);
      }
      rows.sort((a, b) => b[0] - a[0]);
      const out = ['worst SURVEY sweep vs worst splitCell (min of 5), top 8:'];
      for (const r of rows.slice(0, 8)) out.push(`  survey ${r[0].toFixed(2)} ms (${r[2]} findVoid calls) · splitCell ${r[1].toFixed(2)} ms (${r[3]} splits) · ${r[4]} ${r[5]} samples`);
      return '\n' + out.join('\n');
    } finally { restoreShared(shared); }
  });
}
