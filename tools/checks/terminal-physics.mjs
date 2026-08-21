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
   * …AND WHETHER THAT IS EXACT OR MERELY CLOSER, WHICH THE CLAUSE ABOVE CANNOT
   * SAY.
   *
   * Its own printed line reads `dt=0.0333→1.37  dt=0.0667→1.47  dt=0.1000→1.50`
   * against a true 1.35, which looks like a world that still runs slower the
   * worse the frame rate gets. It is not. Those three rates resolve to the SAME
   * substep and produce a byte-identical trajectory; the spread is that check's
   * own sampling — it tests `y > 0.25` once per FRAME, and the box bounces
   * 2.5 cm back above that line after first touching, so a coarse frame misses
   * the first crossing and reports the second. A real fall is over inside a
   * frame, so that is honest for what it measures and useless for this.
   *
   * This measures the accumulator with contact taken out of it: free fall, no
   * ground, an exact number of FRAMES rather than a stopping condition. Two
   * things follow, and both are exact rather than approximate.
   *
   *   · Semi-implicit Euler integrates VELOCITY exactly — v = g·t whatever the
   *     step — so any frame time the world throws away shows up as a velocity
   *     deficit with no tolerance to argue about. On the code this replaced,
   *     ten frames of dt=0.1 advanced 10 x 1/30 s and the body was doing 7.33
   *     m/s where it should be doing 22.
   *   · Distance is not exact and cannot be: a step of h over-falls by g·h·t/2.
   *     But it depends ONLY on h, so every frame rate that resolves to the same
   *     substep must fall the same distance to the last decimal — which is what
   *     "the timestep is conserved" means, as opposed to "it is nearly". The
   *     grouping is read off `stats.substeps`, so it follows the cap rather
   *     than restating it.
   */
  check('physics: a frame of simulation is the same amount of world at every frame rate', () => {
    const { Body, box } = RapierWorldModule;
    const G = -22, SECONDS = 1;
    const rates = [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 20, 1 / 15, 0.1];
    const marks = [];
    for (const dt of rates) {
      const n = Math.round(SECONDS / dt);
      const w = new RapierWorld({ gravity: G });
      const b = w.add(new Body({ position: V(THREE, 0, 400, 0), shape: box(0.2, 0.2, 0.2), mass: 5,
        linearDamping: 0, allowSleep: false }));
      for (let i = 0; i < n; i++) w.step(dt);
      marks.push({ dt, n, fell: 400 - b.position.y, v: -b.velocity.y, h: dt / w.stats.substeps });
      w.dispose();
    }
    const trueV = -G * SECONDS;
    const slow = marks.filter((m) => Math.abs(m.v - trueV) > 1e-3);
    assert(!slow.length,
      `after exactly ${SECONDS} s of frames a body in free fall is doing `
      + slow.map((m) => `${m.v.toFixed(2)} m/s at dt=${m.dt.toFixed(4)}`).join(', ')
      + ` and not ${trueV.toFixed(2)} — the world is not advancing by the frame it was given. A step `
      + 'bound used as a FRAME bound throws the rest of the frame away, so debris, corpses, crates '
      + 'and severed limbs fall slower than the characters walking past them');
    // …and same substep, same fall, to the last decimal.
    const groups = new Map();
    for (const m of marks) {
      const k = m.h.toFixed(6);
      (groups.get(k) || groups.set(k, []).get(k)).push(m);
    }
    const ragged = [...groups.values()].filter((g) => g.length > 1
      && Math.max(...g.map((m) => m.fell)) - Math.min(...g.map((m) => m.fell)) > 1e-6);
    assert(!ragged.length, ragged.map((g) => g.map((m) => `dt=${m.dt.toFixed(4)} fell ${m.fell.toFixed(6)}`).join(' vs ')).join('; ')
      + ' — these rates resolve to the same substep and must therefore produce the same trajectory; '
      + 'they do not, so the substep is not the only thing the frame rate is changing');
    return `1 s of frames in free fall: `
      + marks.map((m) => `dt=${m.dt.toFixed(4)}x${m.n} → ${m.fell.toFixed(3)} m at ${m.v.toFixed(3)} m/s (h=1/${(1 / m.h).toFixed(0)})`).join('; ')
      + ` — v is exact at every rate, and the ${(-G * m0h(marks)).toFixed(3)} m spread in distance is the step's own truncation, g·h·t/2`;
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

  /**
   * THE OTHER SIDE OF THE SAME GUARD, WHICH NOTHING ASKED FOR.
   *
   * The clause above proves the boundary REFUSES a bad impulse. Nothing proved
   * it ADMITS a good one, and a guard with only a refusal clause is the same
   * shape as a check that cannot fail — so the first version of it was sized in
   * the wrong currency and shipped. `MAX_SPEED` is metres per second; an
   * impulse is N·s and carries the body's mass, so `|J| < MAX_SPEED` asks a
   *22 kg crate an easy question and a 900 kg pillar an impossible one.
   * `force.mjs` measured the consequence: at forcePower 4 the pillar went from
   * 31.3 m/s to 0.40, which is one step of gravity, i.e. the push was dropped.
   *
   * The property is stated here as MASS-INVARIANCE, so it needs no number of
   * its own and cannot drift from whatever the bound is set to: the game's own
   * impulses are all mass-proportional (`Player.forcePush` is `mass · 15 · k ·
   * P · heft`, the explosion is `force · k · mass · 0.5`, the ragdoll shove is
   * `mass · 0.4`), so the SPEED a shove buys does not depend on what it is
   * shoving — and neither may the guard. The mass range is the game's own, from
   * the lightest severed finger to the heaviest thing on the roster.
   */
  check('physics: the impulse guard is priced in mass, so one shove means one speed at every weight', async () => {
    const { Body, box } = RapierWorldModule;
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const heaviest = Math.max(...Object.values(ARCHETYPES).map((a) => a.mass || 0));
    // A severed fingertip is the light end (Ragdoll clamps a piece at 0.3 kg);
    // the heaviest body the game can build is the other.
    const masses = [0.3, 1, 22, 90, 500, 900, heaviest];
    /* The largest shove each weight is allowed, found by asking rather than by
     * quoting the bound: double until it is refused, then walk back. */
    const ceiling = (mass) => {
      const w = new RapierWorld({ gravity: 0 });
      let lo = 0, hi = 1;
      const speed = (v) => {
        const b = w.add(new Body({ position: V(THREE, 0, 0, 0), shape: box(0.3, 0.3, 0.3), mass,
          gravityScale: 0, allowSleep: false }));
        b.applyImpulse(V(THREE, mass * v, 0, 0), null);
        w.step(1 / 60);
        const got = b.velocity.length();
        w.remove(b);
        return got;
      };
      for (let i = 0; i < 40 && speed(hi) > hi * 0.5; i++) { lo = hi; hi *= 2; }
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (speed(mid) > mid * 0.5) lo = mid; else hi = mid; }
      w.dispose();
      return lo;
    };
    const rows = masses.map((m) => [m, ceiling(m)]);
    const top = Math.max(...rows.map(([, c]) => c)), bottom = Math.min(...rows.map(([, c]) => c));
    assert(bottom > top * 0.9,
      'the same shove buys a different speed depending on what it is shoving — '
      + rows.map(([m, c]) => `${m} kg admits ${c.toFixed(1)} m/s`).join(', ')
      + ' — the boundary is bounding the IMPULSE, which carries mass, with a number that is a '
      + 'SPEED, so it refuses outright every push heavy enough to be worth making');
    // …and the refusal must still be there, on the value that traps the solver.
    const w = new RapierWorld({ gravity: 0 });
    const b = w.add(new Body({ position: V(THREE, 0, 0, 0), shape: box(0.3, 0.3, 0.3), mass: heaviest,
      gravityScale: 0, allowSleep: false }));
    b.applyImpulse(V(THREE, heaviest * 1e12, 0, 0), null);
    w.step(1 / 60);
    const trapSpeed = b.velocity.length();
    w.dispose();
    assert(trapSpeed === 0,
      `a 1e12 m/s shove on the heaviest body in the game was ADMITTED (${trapSpeed}) — the guard has `
      + 'been widened past the value Rapier traps out of wasm on');
    return `one shove, ${rows.length} weights from ${masses[0]} to ${heaviest} kg: admitted up to `
      + rows.map(([m, c]) => `${m}kg→${c.toFixed(0)}`).join(', ') + ' m/s, and 1e12 still refused';
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

/** The largest step in a sweep, for reporting the truncation term g·h·t/2. */
function m0h(marks) { return Math.max(...marks.map((m) => m.h)) / 2; 

  check('physics: a static box switched off is switched off for EVERYTHING', async () => {
    /**
     * `disabled` IS READ BY SIX HAND-ROLLED QUERIES AND WAS A LIE TO ALL OF
     * THEM. `Support.supportHeight` and `ceilingHeight`, `Player._gatherNear`
     * and `_collide`, and both of `Enemy`'s sweeps all skip a box carrying it;
     * `addStaticBox` wrote it into the record as a plain field and left a live
     * Rapier cuboid in the solver, which reads nothing. So a box switched off
     * was passable to the player and to every droid and solid to everything
     * that goes through the solver — an invisible wall by construction, and the
     * player has already reported one of those on Geonosis by hand.
     *
     * It was found on a breached blast door, where a crate shoved at 9 m/s
     * bounced off the plane of a door it had just watched fall out: 0.92 m in
     * front of the doorway, and it never moved. That call site removes its
     * collider outright, which is right for a door that is GONE. This is the
     * other half of the same defect — a caller who wants the box BACK writes
     * the flag — and it is checked here because `RapierWorld` is the layer that
     * owes the guarantee.
     *
     * The measurement is a body falling: on a live box it rests on top of it,
     * and on a switched-off one it goes past.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    const { RapierWorld, Body } = await import('../../src/physics/RapierWorld.js');
    const { boxSpheres, LAYER } = await import('../../src/physics/Physics.js');
    await initPhysics();

    const drop = (off, back = false) => {
      const w = new RapierWorld({ gravity: -22, iterations: 4, maxBodies: 64 });
      const box = w.addStaticBox(new THREE.Vector3(0, 1, 0), new THREE.Vector3(3, 0.5, 3));
      if (off) box.disabled = true;
      if (back) box.disabled = false;
      const b = new Body({
        position: new THREE.Vector3(0, 4, 0),
        shape: { type: 'box', hx: 0.4, hy: 0.4, hz: 0.4 },
        spheres: boxSpheres(0.4, 0.4, 0.4), mass: 20,
        layer: LAYER.DEBRIS, mask: LAYER.ALL,
      });
      w.add(b);
      for (let i = 0; i < 120; i++) w.step(1 / 60);
      const y = b.position.y;
      const flag = box.disabled;
      w.dispose();
      return { y, flag };
    };

    const on = drop(false);
    const off = drop(true);
    const again = drop(true, true);
    assert(on.y > 1.2,
      `a crate dropped onto a live static box came to rest at y=${on.y.toFixed(2)} — the fixture is not `
      + 'dropping anything onto anything');
    assert(off.y < 0,
      `a crate dropped onto a DISABLED static box rested at y=${off.y.toFixed(2)} — the flag six queries `
      + 'honour means nothing to the solver, so the box is passable to the player and solid to the crate');
    /* AND IT COMES BACK, because a flag that only ever switches off is a
     * remove() with a worse name. */
    assert(again.y > 1.2,
      `switched off and on again, the crate rested at y=${again.y.toFixed(2)} instead of on top of the box`);
    assert(on.flag === false && off.flag === true,
      'the property does not read back what was written to it');
    return `live ${on.y.toFixed(2)} m · disabled ${off.y.toFixed(2)} m · re-enabled ${again.y.toFixed(2)} m`;
  });
}
