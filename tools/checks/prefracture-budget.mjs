/**
 * BATTLEFRONT BORZ — the half of the preparation budget that was never inside it.
 *
 * `Destruction._prepare` gets a piece ready to break before the player is near
 * enough to break it, `prepareBudgetMs = 1.2` at a time. That budget was only
 * ever a loop guard: once inside, the cell build ran to completion and
 * returned, under a comment that said so in as many words —
 * `return; // cells are a whole frame's work`. Giving it a whole frame was a
 * deliberate, documented decision.
 *
 * A whole frame is not enough either. Every structure in the game, timed
 * individually through its own `prefracture()` on a freshly loaded level:
 *
 *   level      structs   median   p90     max     over 16.7 ms
 *   temple       126      8.96   19.00   51.03      16
 *   foundry       41      9.91   12.88   25.13       2
 *   intake        41      9.73   12.43   13.25       0
 *   warship       40      9.38   17.09   43.15       5
 *   arena         43      5.58   17.88   29.42       6
 *   colosseum     46      3.78   12.07   30.34       4
 *   kamino        51      3.10   19.61   21.70       7
 *   mustafar       1     76.35   76.35   76.35       1
 *   ALL          389      7.97   17.15   76.35      41 = 11%
 *
 * — up to 4.6x the one frame it was allotted, and it fires on APPROACH, at 30
 * m, not on contact. Measured in play, a player walking a 22 m circle on the
 * temple with the director off and NO enemies at all, 3000 frames: the
 * approach-time preparation cost p99 12.9 ms and a worst frame of 60.2, with
 * four frames over a whole 16.7 ms budget, and nothing on screen to explain any
 * of them. The half that WAS budgeted behaved perfectly throughout — 1067 cells
 * of geometry at a median 0.04 ms each.
 *
 * The same walk with the cell build sliced: p99 4.80 ms, worst frame 11.8, ZERO
 * frames over 16.7, and exactly the same 57 of 126 structures fully prepared at
 * the end of it. The work is not reduced; it is cut up.
 *
 * WHAT THIS FILE HOLDS.
 *
 * 1. That the sliced build produces the SAME CELLS. A fracture that is faster
 *    to spread and wrong is worse than a hitch: the cells are the piece's
 *    collision, its support graph and its silhouette. So the first check
 *    fractures every structure on a level twice through the shipped code —
 *    once in one call, once chopped as finely as the slicing allows, with a
 *    deadline that expires on every single look — and compares the two cell
 *    for cell, vertex for vertex, with `Object.is`.
 *
 * 2. That the approach-time path actually stops. Driven through the real
 *    `Destruction.update` with a real World and a walking player, timing the
 *    manager's own `_prepare` and asserting no frame of it exceeds a frame.
 *
 * 3. That the on-hit path still finishes in one call, because four callers
 *    depend on it: `cutBy`, `damageSphere`, `collapse` and the blade's
 *    `_impactScan` all open with `prefracture()` and cannot proceed without
 *    cells. A piece caught halfway through its unhurried build must come out
 *    of a single synchronous call fully fractured.
 */

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

/** Every vertex of every face, in order, exactly. */
function samePoly(a, b) {
  if (a.length !== b.length) return `face count ${a.length} vs ${b.length}`;
  for (let f = 0; f < a.length; f++) {
    if (a[f].length !== b[f].length) return `face ${f} has ${a[f].length} vertices, not ${b[f].length}`;
    for (let v = 0; v < a[f].length; v++) {
      const p = a[f][v], q = b[f][v];
      if (!Object.is(p.x, q.x) || !Object.is(p.y, q.y) || !Object.is(p.z, q.z)) {
        return `vertex ${f}/${v} moved by ${Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z))} m`;
      }
    }
  }
  return null;
}


export async function run({ check, assert, THREE }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  check('prefracture: the same cells come out however finely the build is chopped', async () => {
    /**
     * Both sides are the shipped code on the same live structure: the eager
     * entry point drains the job with a deadline that never expires, and the
     * sliced side drives the same job with one that expires on EVERY look, so
     * it stops at every seam there is. If any of the four hot loops carried
     * state across a cut it could not carry, or a phase re-ran a partial
     * accumulation, this is where it shows up.
     */
    const { fractureJob, surfaceJob } = await import('../../src/world/Destruction.js');
    assert(typeof fractureJob === 'function' && typeof surfaceJob === 'function',
      'the fracture no longer exposes a resumable job — the cell build has gone back to being '
      + 'a single call the manager cannot interrupt');

    const shared = await snapshotShared();
    try {
      const world = await loadWorld(THREE, 'temple');
      const D = world.destruction;
      assert(D && D.structures.length > 30, 'the temple has no destructible architecture to fracture');

      let pieces = 0, cells = 0, resumes = 0, bad = 0;
      let first = '';
      for (const s of D.structures) {
        if (s.chunks) continue;
        // the surface stream, whole and chopped
        const whole = s._surfaceSamples();
        const sJob = surfaceJob(s);
        while (!sJob.step(() => true)) resumes++;
        const chopped = sJob.result;
        for (const key of ['samples', 'normals', 'corners', 'triAt']) {
          const a = whole[key] || [], b = chopped[key] || [];
          if (a.length !== b.length) { bad++; if (!first) first = `${s.id}: ${key} length ${a.length} vs ${b.length}`; continue; }
          for (let i = 0; i < a.length; i++) {
            if (!Object.is(a[i], b[i])) { bad++; if (!first) first = `${s.id}: ${key}[${i}] ${a[i]} vs ${b[i]}`; break; }
          }
        }

        const bounds = s.local.clone();
        if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
        const opts = () => ({
          cell: s.profile.cell, seed: s.seed * 131 + 7, maxCells: D.maxCellsPerPiece,
          matOf: (i) => whole.mats[i], normals: whole.normals, corners: whole.corners, triAt: whole.triAt,
        });
        const eager = fractureJob(bounds.clone(), whole.samples, opts());
        eager.step(() => false);
        const sliced = fractureJob(bounds.clone(), whole.samples, opts());
        while (!sliced.step(() => true)) resumes++;

        pieces++;
        if (eager.cells.length !== sliced.cells.length) {
          bad++;
          if (!first) first = `${s.id}: ${eager.cells.length} cells in one call, ${sliced.cells.length} sliced`;
          continue;
        }
        for (let i = 0; i < eager.cells.length; i++) {
          cells++;
          const a = eager.cells[i], b = sliced.cells[i];
          const why = samePoly(a.poly, b.poly)
            || (!Object.is(a.volume, b.volume) ? `volume ${a.volume} vs ${b.volume}` : null)
            || (a.centre.distanceTo(b.centre) !== 0 ? 'centroid moved' : null)
            || (a.samples !== b.samples ? `sample count ${a.samples} vs ${b.samples}` : null)
            || (a.mat !== b.mat ? 'material' : null)
            || (a.site !== b.site ? 'site index' : null)
            || (String(a.nbrs) !== String(b.nbrs) ? `neighbours ${a.nbrs} vs ${b.nbrs}` : null);
          if (why) { bad++; if (!first) first = `${s.id} cell ${i}: ${why}`; }
        }
      }
      assert(resumes > 2000, `the sliced path only stopped ${resumes} times — it is not being cut up`);
      assert(bad === 0,
        `${bad} differences between the whole build and the sliced one over ${pieces} pieces and `
        + `${cells} cells. A piece that fractures differently depending on how many frames it took `
        + `has a different collision shape, a different support graph and a different silhouette. `
        + `First: ${first}`);
      return `${pieces} pieces, ${cells} cells, identical to the last vertex across ${resumes} resumptions`;
    } finally { restoreShared(shared); }
  });

  check('prefracture: preparing a piece the player is walking towards never costs a frame', async () => {
    /**
     * Driven through the real manager on a real level with a real player
     * walking, because the claim is about what `_prepare` spends per frame and
     * that is a property of the manager's loop, not of any one function.
     *
     * The on-hit path is deliberately excluded and deliberately NOT bounded: a
     * blade that has just reached a piece needs its cells in that frame, and
     * `prefracture()` still delivers them in one call. Only the speculative,
     * approach-time work has to fit in a budget.
     */
    const shared = await snapshotShared();
    const world = await loadWorld(THREE, 'temple');
    const D = world.destruction;
    const { Structure } = await import('../../src/world/Destruction.js');
    const manager = Object.getPrototypeOf(D);
    const prepOrig = manager._prepare;

    /**
     * `_prepare` IS the approach-time path and nothing else is. The on-hit
     * callers reach `prefracture()` from `_impactScan`, `cutBy` and
     * `damageSphere`, none of which is under this call, so timing this one
     * function separates the two without needing to fence anything off.
     *
     * THE HEADLINE NUMBER HERE IS A COUNT, NOT A CLOCK. This box has three
     * other agents on it and a millisecond threshold on it is noise — and the
     * defect was never "slow", it was "indivisible". So what is asserted is how
     * many separate `_prepare` calls each piece's cell build was spread over:
     * before, every single piece was built start to finish inside one call,
     * because that is what `s.prefracture(); return;` does. The wall clock is
     * asserted too, but loosely, as the player-facing consequence.
     */
    const spend = [];
    let call = 0;
    const frames = new Map();                  // structure → _prepare calls it took
    let inPrepare = false;
    const seen = (s) => {
      if (!inPrepare || s.chunks) return;
      let set = frames.get(s);
      if (!set) frames.set(s, set = new Set());
      set.add(call);
    };
    const eagerOrig = Structure.prototype.prefracture;
    const stepOrig = Structure.prototype.stepPrefracture;
    Structure.prototype.prefracture = function () { seen(this); return eagerOrig.call(this); };
    if (stepOrig) Structure.prototype.stepPrefracture = function (ob) { seen(this); return stepOrig.call(this, ob); };
    manager._prepare = function (f) {
      call++; inPrepare = true;
      const t = performance.now();
      try { return prepOrig.call(this, f); } finally { inPrepare = false; spend.push(performance.now() - t); }
    };
    try {
        const p = world.player, c = p.position.clone();
        const input = idleInput();
        for (let f = 0; f < 30; f++) world.update(1 / 60, input);
        spend.length = 0;
        for (let f = 0; f < 1800; f++) {
          const a = (f / 60) * (5 / 22);           // a 22 m circle at 5 m/s
          p.position.set(c.x + Math.cos(a) * 22, p.position.y, c.z + Math.sin(a) * 22);
          world.update(1 / 60, input);
        }
        const fired = spend.filter((x) => x > 0.05).sort((a, b) => a - b);
        const prepared = D.structures.filter((s) => s.prepared).length;
        assert(prepared >= 20,
          `only ${prepared} of ${D.structures.length} structures were prepared in 30 s of walking — the `
          + 'budget is now so tight that nothing gets ready before the player reaches it, which trades '
          + 'an approach hitch for a contact hitch');
        assert(fired.length > 40, `the preparation only ran on ${fired.length} frames — nothing was measured`);

        const built = [...frames.values()].map((s) => s.size).sort((a, b) => a - b);
        assert(built.length >= 15, `only ${built.length} pieces were built by the approach path — nothing was measured`);
        const inOne = built.filter((n) => n === 1).length;
        assert(inOne <= built.length * 0.5,
          `${inOne} of the ${built.length} pieces the approach path built were fractured start to finish `
          + 'inside a SINGLE frame — the cell build is indivisible again, so the budget is a loop guard '
          + 'and not a budget, and the piece costs whatever it costs in the one frame it lands on');

        const worst = fired[fired.length - 1];
        const p99 = fired[Math.floor(fired.length * 0.99)];
        assert(worst < 16.7,
          `the worst approach-time preparation frame spent ${worst.toFixed(1)} ms — a whole frame or more `
          + 'on getting a piece ready that the player has not touched, which is the hitch this budget '
          + 'exists to prevent (it was 60.2 ms before the build was sliced)');
        return `${built.length} pieces built over 30 s of walking, spread over a median of `
          + `${built[built.length >> 1]} frames each (${inOne} took only one); preparation cost median `
          + `${fired[fired.length >> 1].toFixed(2)}, p99 ${p99.toFixed(2)}, worst ${worst.toFixed(2)} ms; `
          + `${prepared}/${D.structures.length} structures ready`;
    } finally {
      manager._prepare = prepOrig;
      Structure.prototype.prefracture = eagerOrig;
      if (stepOrig) Structure.prototype.stepPrefracture = stepOrig;
      restoreShared(shared);
    }
  });

  check('prefracture: a piece that is hit halfway through its build still comes out whole', async () => {
    /**
     * `cutBy`, `damageSphere`, `collapse` and `_impactScan` all open with
     * `prefracture()` and then use `this.chunks` on the next line. Slicing the
     * build must not leave any of them holding half a piece — and, just as
     * important, a piece the manager has half built must not be visible AS half
     * built to anything that reads `chunks` to mean "is this fractured yet".
     */
    const shared = await snapshotShared();
    try {
      const world = await loadWorld(THREE, 'temple');
      const D = world.destruction;
      let checked = 0, partials = 0;
      for (const s of D.structures) {
        if (s.chunks || s.state === 'gone') continue;
        // stop it at the very first seam, then look at what the rest of the file
        // can see
        const going = s.stepPrefracture(() => true);
        if (going) continue;                       // finished in one slice; nothing to test
        partials++;
        assert(!s.chunks,
          `${s.id} is half fractured and already publishing chunks — every "if (!s.chunks)" in `
          + 'Destruction.js now means "if this piece has not STARTED", and a cut would land on a '
          + 'piece whose support graph does not exist yet');
        assert(!s.prepared, `${s.id} reports itself prepared with the build unfinished`);
        // …and now the on-hit path, in one call
        const chunks = s.prefracture();
        checked++;
        assert(Array.isArray(chunks) && chunks.length > 0,
          `${s.id} came out of a synchronous prefracture() with ${chunks && chunks.length} cells`);
        assert(s.chunks === chunks && s.prepared === false || s.chunks === chunks,
          `${s.id} did not adopt the cells it just built`);
        for (const c of s.chunks) {
          assert(c.cell && c.bounds && c.volume > 0, `${s.id} built a cell with no solid`);
        }
        // the support graph is the thing that only exists after the last stage
        const linked = s.chunks.reduce((n, c) => n + (c.neighbours ? c.neighbours.length : 0), 0);
        assert(s.chunks.length < 2 || linked > 0,
          `${s.id} has ${s.chunks.length} cells and no support links between any of them — _link never ran`);
        if (checked >= 25) break;
      }
      assert(partials >= 10, `only ${partials} pieces could be caught mid-build — the slicing is too coarse to test`);
      assert(checked >= 10, `only ${checked} pieces were driven through the on-hit path`);
      return `${partials} pieces stopped at their first seam looked untouched to the rest of the file; `
        + `${checked} of them then fractured fully in one synchronous call`;
    } finally { restoreShared(shared); }
  });

}
