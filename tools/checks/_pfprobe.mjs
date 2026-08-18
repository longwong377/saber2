/* TEMPORARY diagnostic probe — deleted before the report.
 *
 * THE LOAD-PROOF QUESTION. `_prepare`'s own guard is `now() - t0 >= 1.2`, so a
 * slice can only exceed 1.2 ms by however long the work between two consecutive
 * consultations of that guard takes. Wall clock cannot separate "the box was
 * busy" from "the work is indivisible"; the COUNT of consultations can, because
 * a stalled process still consults the guard exactly as often as a quiet one.
 */
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

  check('slices, with the guard counted', async () => {
    const shared = await snapshotShared();
    const world = await loadWorld(THREE, 'colosseum');
    const D = world.destruction;
    const { Structure } = await import('../../src/world/Destruction.js');
    const manager = Object.getPrototypeOf(D);
    const prepOrig = manager._prepare;
    const stepOrig = Structure.prototype.stepPrefracture;
    const cellOrig = Structure.prototype.prepareCell;

    const slices = [];      // one per _prepare call that did anything
    let cur = null;
    Structure.prototype.stepPrefracture = function (ob) {
      let reads = 0, last = performance.now(), worstGap = 0, worstAt = 0;
      const stage0 = this._pf ? this._pf.stage : -1;
      const wrapped = () => {
        const t = performance.now();
        const g = t - last;
        if (g > worstGap) { worstGap = g; worstAt = (this._pf && this._pf.stage === 1)
          ? globalThis.__pfPhase + (globalThis.__pfSt ? ` cnt=${globalThis.__pfSt.cnt} sites=${globalThis.__pfSt.sites.length} kept=${globalThis.__pfSt.kept.length}` : '')
          : 'stage' + (this._pf ? this._pf.stage : -1); }
        last = t; reads++;
        return ob();
      };
      const t0 = performance.now();
      const r = stepOrig.call(this, wrapped);
      const ms = performance.now() - t0;
      const tail = performance.now() - last;
      if (cur) cur.steps.push({ id: this.id, ms, reads, stage0,
        stage1: this._pf ? this._pf.stage : 4, worstGap, worstAt, tail });
      return r;
    };
    Structure.prototype.prepareCell = function (c) {
      const t = performance.now();
      const r = cellOrig.call(this, c);
      if (cur) cur.cells.push(performance.now() - t);
      return r;
    };
    manager._prepare = function (f) {
      cur = { steps: [], cells: [], ms: 0 };
      const t = performance.now();
      try { return prepOrig.call(this, f); }
      finally { cur.ms = performance.now() - t; slices.push(cur); cur = null; }
    };
    try {
      const p = world.player, c = p.position.clone();
      const input = idleInput();
      for (let f = 0; f < 30; f++) world.update(1 / 60, input);
      slices.length = 0;
      for (let f = 0; f < 1800; f++) {
        const a = (f / 60) * (5 / 22);
        p.position.set(c.x + Math.cos(a) * 22, p.position.y, c.z + Math.sin(a) * 22);
        world.update(1 / 60, input);
      }
      const fired = slices.filter((s) => s.ms > 0.05).sort((a, b) => b.ms - a.ms);
      const out = [`budget ${D.prepareBudgetMs} ms · ${fired.length} slices did work`];
      const ms = fired.map((s) => s.ms).sort((a, b) => a - b);
      out.push(`slice ms: median ${ms[ms.length >> 1].toFixed(2)} p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(2)} `
        + `p99 ${ms[Math.floor(ms.length * 0.99)].toFixed(2)} worst ${ms[ms.length - 1].toFixed(2)}`);
      out.push('--- the ten most expensive slices ---');
      for (const s of fired.slice(0, 10)) {
        const st = s.steps.map((x) => `${x.id} ${x.ms.toFixed(1)}ms reads=${x.reads} `
          + `stage ${x.stage0}->${x.stage1} worstGap=${x.worstGap.toFixed(1)}ms@${x.worstAt} tail=${x.tail.toFixed(1)}ms`).join(' | ');
        const ce = s.cells.length ? ` cells=[${s.cells.map((x) => x.toFixed(1)).join(',')}]` : '';
        out.push(`${s.ms.toFixed(1)} ms :: ${st || '(no step)'}${ce}`);
      }
      const gaps = [];
      for (const s of slices) for (const x of s.steps) gaps.push([x.worstGap, x.id, x.worstAt, x.reads]);
      gaps.sort((a, b) => b[0] - a[0]);
      out.push('--- worst gaps between two consultations of the budget ---');
      for (const g of gaps.slice(0, 8)) out.push(`  ${g[0].toFixed(1)} ms in ${g[2]} · ${g[1]} (that step read the guard ${g[3]}x)`);
      const cellMs = slices.flatMap((s) => s.cells).sort((a, b) => a - b);
      if (cellMs.length) out.push(`prepareCell: n=${cellMs.length} median ${cellMs[cellMs.length >> 1].toFixed(2)} worst ${cellMs[cellMs.length - 1].toFixed(2)} ms`);
      return '\n' + out.join('\n');
    } finally {
      manager._prepare = prepOrig;
      Structure.prototype.stepPrefracture = stepOrig;
      Structure.prototype.prepareCell = cellOrig;
      restoreShared(shared);
    }
  });
}
