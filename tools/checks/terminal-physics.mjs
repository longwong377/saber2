/**
 * BATTLEFRONT BORZ — a physics world that is dead stays dead. — src/physics/RapierWorld.js
 *
 * `dispose()` frees the Rapier world and sets `dead`, and the note over it
 * explains why the last thing teardown does must not be an allocation: a
 * Rapier world is a broad phase, a narrow phase, an island manager and every
 * pipeline, all of it inside WASM linear memory, which is monotonic and never
 * handed back.
 *
 * The guard was on `dispose()` and not on `clear()`, and `clear()` is where the
 * allocation is. So a SECOND teardown walked past the guard and built one:
 *
 *   world.dispose();   // physics.world === null, physics.dead === true
 *   world.dispose();   // physics.world is a live RAPIER.World again, with
 *                      // physicsPipeline, serializationPipeline and
 *                      // debugRenderPipeline all freshly constructed
 *
 * — and `physics.dispose()` then declines to free it, because `dead` is already
 * true. A third dispose strands another. The path that reaches it in the
 * shipping game is `deploy()`'s own recovery in main.js: `buildWorld` opens
 * with `if (world) { world.dispose(); world = null; }`, so if that dispose
 * throws, the module-level `world` is still the old one and the catch block
 * disposes it a second time.
 *
 * The other half of the same contract: `add()`, `removeStaticBox()`, `step()`,
 * `raycast()`, `querySphere()` and `clear()` all refuse cleanly on a dead
 * world, while `addStaticBox()` and the terrain setter threw
 * `Cannot read properties of null (reading 'createCollider')`. Neither is
 * reachable from the shipping game — every `addStaticBox` caller in src/ runs
 * during level dressing on a live world, and `World.unload()` only ever assigns
 * `terrain = null`, which the setter skips — but a terminal state that refuses
 * six entry points and throws on two is a coincidence, not a contract, and the
 * next caller to be added does not know which kind it has found.
 *
 * NOTE FOR ANYONE RE-RUNNING THIS BY HAND: the probe ORDER matters and it is
 * easy to get a false pass. Calling `clear()` before `addStaticBox()` on the
 * unfixed code reallocates `this.world`, and both throwing entry points then
 * "refuse cleanly" — which is how the hole hides.
 */

import { snapshotShared, restoreShared } from './_shared.mjs';


const V = (THREE, x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert, THREE }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const RAPIER = await initPhysics();
  const RapierWorldModule = await import('../../src/physics/RapierWorld.js');
  const { RapierWorld } = RapierWorldModule;

  check('physics: a disposed world does not build another one when it is torn down again', () => {
    const w = new RapierWorld({ gravity: -22 });
    assert(w.world, 'the world was born without a Rapier world');
    w.dispose();
    assert(w.dead === true, 'dispose() did not mark the world dead');
    assert(w.world === null, 'dispose() left a live Rapier world allocated');

    // …and the second teardown, which is the one the recovery path in
    // deploy() actually performs.
    w.dispose();
    assert(w.world === null,
      'a second dispose() built a fresh Rapier world — a whole broad phase, narrow phase, island '
      + 'manager and pipeline set inside WASM linear memory, with no reference in the program that '
      + 'can reach it and nothing that will ever free it');

    // and `clear()` reached directly, which is what World.unload() calls and
    // what the second dispose() goes through
    w.clear();
    assert(w.world === null,
      'clear() on a dead world reallocated it — the terminal state is not terminal, so every extra '
      + 'teardown strands another Rapier world');
    w.clear(true);
    assert(w.world === null, 'clear(true) on a dead world reallocated it');

    // A LIVE world must still get its replacement: this is the level change,
    // and breaking it would break every deploy.
    const live = new RapierWorld({ gravity: -22 });
    const before = live.world;
    live.clear();
    assert(live.world && live.world !== before,
      'clear() on a LIVE world no longer hands back a fresh one — a level change would leave the '
      + 'game with no physics at all');
    assert(live.world instanceof RAPIER.World, 'clear() handed back something that is not a Rapier world');
    live.dispose();
    return 'dispose, dispose, clear, clear — one Rapier world freed and none allocated; a live '
      + 'world still gets its replacement';
  });

  check('physics: every entry point on a dead world refuses instead of throwing', async () => {
    /**
     * Driven, one call at a time, with `addStaticBox` FIRST — see the note at
     * the top of this file for why the order is the whole test.
     */
    const { Body, capsule } = await import('../../src/physics/RapierWorld.js');
    const w = new RapierWorld({ gravity: -22 });
    const body = new Body({ position: V(THREE, 0, 2, 0), shape: capsule(0.6, 0.3), mass: 70 });
    w.add(body);
    w.dispose();

    const tried = [];
    const probe = (name, fn) => {
      try { fn(); tried.push(name); } catch (e) {
        throw new Error(`${name} threw on a disposed world instead of refusing: ${e.message}. `
          + 'add(), step(), raycast(), querySphere() and removeStaticBox() all return quietly, so a '
          + 'caller has no way to know which of these it is holding');
      }
    };

    probe('addStaticBox', () => {
      const rec = w.addStaticBox(V(THREE, 0, 0, 0), V(THREE, 1, 1, 1));
      assert(rec === null, `addStaticBox on a dead world returned ${rec}, not null`);
      assert(w.staticBoxes.length === 0, 'a dead world took a static box into its list');
    });
    probe('set terrain', () => {
      w.terrain = { size: 256, res: 33, heights: new Float32Array(33 * 33), height: () => 0 };
      assert(w._hf === null, 'a dead world built a heightfield collider');
    });
    probe('add', () => {
      const b2 = new Body({ position: V(THREE, 0, 2, 0), shape: capsule(0.6, 0.3), mass: 70 });
      assert(w.add(b2) === b2 && b2.dead === true, 'add() on a dead world did not hand back a dead body');
    });
    probe('removeStaticBox', () => w.removeStaticBox({ collider: null }));
    probe('step', () => w.step(1 / 60));
    probe('raycast', () => w.raycast(V(THREE, 0, 5, 0), V(THREE, 0, -1, 0), 20));
    probe('querySphere', () => w.querySphere(V(THREE, 0, 0, 0), 5, []));
    probe('dispose again', () => w.dispose());
    assert(w.world === null, 'one of the probes left a Rapier world allocated on a dead world');
    return `${tried.length} entry points driven on a disposed world in the order that exposes the `
      + `hole — ${tried.join(', ')} — none threw, none allocated`;
  });

  /**
   * THE CLAUSE THAT WOULD HAVE CAUGHT THE THIRD-SPEED WORLD.
   *
   * `step` opened `dt = Math.min(dt, 1/30)` with no substep. 1/30 is a
   * stability bound on ONE integration step; as a bound on the FRAME it throws
   * the rest of the frame away, and main.js clamps at 0.1 and hands that whole
   * value to every player, enemy, blade and bolt. So below 30 fps the rigid
   * body world ran slow while everything the player drives ran at full speed —
   * measured, a 20 m fall took 4.10 s at dt=0.1 against a true 1.35.
   *
   * Nothing anywhere asked a physics world to advance the same interval at two
   * frame rates and compare. `somersault.mjs` is the one file in tools/ that
   * sweeps to 10 Hz, and it drives `cl.update(dt)` directly and never
   * `world.physics.step(dt)`.
   *
   * The bar is deliberately the ANALYTIC answer rather than the 1/60 answer, so
   * this cannot be satisfied by making every rate equally wrong.
   */
  check('physics: the world advances by the frame it was given, at any frame rate', () => {
    const { Body, box } = RapierWorldModule;
    const G = -22, H = 20;
    const truth = Math.sqrt(2 * H / -G);          // 1.348 s
    const rates = [1 / 240, 1 / 60, 1 / 30, 1 / 15, 0.1];
    const marks = [];
    for (const dt of rates) {
      const w = new RapierWorld({ gravity: G });
      w.addStaticBox(V(THREE, 0, -0.5, 0), V(THREE, 60, 0.5, 60));
      const b = new Body({ position: V(THREE, 0, H, 0), shape: box(0.2, 0.2, 0.2), mass: 5, linearDamping: 0 });
      w.add(b);
      let t = 0;
      while (t < 30 && b.position.y > 0.25) { w.step(dt); t += dt; }
      w.dispose();
      // One step of sampling error is unavoidable — the fall is over somewhere
      // inside the last step — so the tolerance is a step plus a tenth.
      const slack = dt + 0.1;
      marks.push({ dt, t, slack });
    }
    const bad = marks.filter((m) => Math.abs(m.t - truth) > m.slack);
    assert(!bad.length,
      `a 20 m fall at g=22 takes ${truth.toFixed(2)} s, and the world disagrees at `
      + bad.map((m) => `dt=${m.dt.toFixed(4)} → ${m.t.toFixed(2)} s`).join(', ')
      + ' — a step bound used as a frame bound throws the rest of the frame away, so debris, '
      + 'corpses, crates and severed limbs fall slower than the characters walking past them, '
      + 'and Destruction._impactScan stops seeing impacts because the velocity it gates on is '
      + 'scaled down with them');
    return `20 m fall, true ${truth.toFixed(2)} s — `
      + marks.map((m) => `dt=${m.dt.toFixed(4)}→${m.t.toFixed(2)}`).join('  ');
  });

  /**
   * THE CLAUSE FOR THE NON-FINITE BODY.
   *
   * Rapier rejects NaN on the way in, so NaN is not the reachable failure —
   * Infinity is. It is accepted, and `Infinity − Infinity` inside the solver
   * turns the transform to NaN permanently. Both of the things that would then
   * remove the body are `<` comparisons, and every comparison against NaN is
   * false, so the body is never culled, never sleeps, costs a full island solve
   * for the rest of the session and drags its mesh to a NaN matrix. Measured on
   * the unguarded code: one `applyImpulse(Infinity,0,0)`, 3 000 steps, and the
   * body is still there at NaN with `stats.awake = 1`.
   */
  check('physics: an infinite impulse cannot leave a body in the world at NaN', () => {
    const { Body, box } = RapierWorldModule;
    const w = new RapierWorld({ gravity: -22 });
    w.addStaticBox(V(THREE, 0, -0.5, 0), V(THREE, 60, 0.5, 60));
    const shots = [
      ['impulse', (b) => b.applyImpulse(V(THREE, Infinity, 0, 0), null)],
      ['impulse at a point', (b) => b.applyImpulse(V(THREE, 0, -Infinity, 0), V(THREE, 0, 3, 0))],
      ['impulse at an infinite point', (b) => b.applyImpulse(V(THREE, 0, 4, 0), V(THREE, Infinity, 0, 0))],
      ['torque', (b) => b.applyTorqueImpulse(V(THREE, Infinity, Infinity, 0))],
      ['velocity', (b) => b.velocity.set(Infinity, 0, 0)],
      ['position', (b) => b.position.set(0, Infinity, 0)],
      ['1e12 velocity', (b) => b.velocity.set(1e12, 0, 0)],
    ];
    const survivors = [];
    for (const [name, shoot] of shots) {
      const b = w.add(new Body({ position: V(THREE, 0, 3, 0), shape: box(0.5, 0.5, 0.5), mass: 10 }));
      shoot(b);
      // A large enough value does not go to NaN, it TRAPS out of wasm at around
      // 1e12 and takes the process with it, so the trap is caught and reported
      // as what it is rather than as a bare `unreachable`.
      try { for (let i = 0; i < 600; i++) w.step(1 / 60); } catch (e) {
        assert(false, `a non-finite ${name} trapped the solver out of wasm (${e.message}) — `
          + 'nothing on this side of the boundary refused it'
          + (survivors.length ? `; and before it, ${survivors.join('; ')} were left in the world at NaN` : ''));
      }
      const p = b.position;
      const nan = !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z);
      if (nan && w.bodies.includes(b)) survivors.push(`${name} → ${p.toArray().join(',')}`);
      if (w.bodies.includes(b)) w.remove(b);
    }
    w.dispose();
    assert(!survivors.length,
      `a non-finite ${survivors.join('; ')} left a body in the world with a NaN transform — `
      + 'the kill plane (y < killY) and the sleep test are both `<`, and every comparison against '
      + 'NaN is false, so it is stepped and solved forever and its mesh is drawn at a NaN matrix');
    return `${shots.length} ways of handing the solver a non-finite value — impulse, point, torque, `
      + 'velocity, position, 1e12 — none of them left a body at NaN in the world';
  });

  check('physics: a World disposed twice leaves nothing behind', async () => {
    /* The same property one level up, through the real World, because that is
     * the shape `deploy()`'s recovery produces. */
    const shared = await snapshotShared();
    try {
      const H = await import('./_coop.mjs');
      const { world } = await H.bootWorld({ level: 'colosseum' });
      const physics = world.physics;
      assert(physics.world, 'the world booted without a physics world');
      world.dispose();
      assert(physics.world === null && physics.dead === true, 'the first dispose left physics alive');
      world.dispose();
      assert(physics.world === null,
        'disposing a World twice strands a Rapier world: the second unload() reaches physics.clear(), '
        + 'which rebuilds one, and physics.dispose() then declines to free it because `dead` is '
        + 'already true');
      world.dispose();
      assert(physics.world === null, 'a third dispose stranded one');
      return 'three World.dispose() calls, one Rapier world, freed once';
    } finally { restoreShared(shared); }
  });

}
