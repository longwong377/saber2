/**
 * BATTLEFRONT BORZ — the places on a big body worth aiming at.
 *
 * Player note #35: "big bodies need weak points." The roster's large targets
 * were the same act to fight as a B1 with more hit points, and the measurement
 * behind that sentence is one number — **every `big` body on the roster carried
 * exactly TWO distinct toughnesses across all of its bones**, the trunk and
 * everything else. An acklay's twenty-five non-trunk bones were all `flesh`; a
 * spider walker's seventeen were all `heavy`.
 *
 * ── WHAT WAS BUILT, IN ONE PARAGRAPH ──────────────────────────────────────
 *
 * A weak point is a place the body's own cover does not reach. `limbPlate`
 * (Bodies.js) is handed the exact span of every plate strapped to a limb, so
 * the two spans it leaves bare — one at each end, because a limb has to bend at
 * both — are derived from the plate's own numbers rather than typed beside the
 * roster. `Enemy.capsules()` publishes each as its own capsule, charged one
 * rung DOWN the `TOUGHNESS` ladder (`thinner`), floored at what the body is
 * made of; `_turnCut` does not turn a pass that lands in one, but only on a
 * LIMB — `AXIAL_ROLES` decides, and it is called rather than restated.
 *
 * ── WHAT THIS FILE PINS, AND WHY EACH ONE ─────────────────────────────────
 *
 *   DERIVED      the spots are the plate's leftovers and the belly's own four
 *                numbers. Nothing here lists a bone name, and the check that a
 *                plated limb has a joint is what stops the derivation quietly
 *                becoming a no-op.
 *   THINNER      one rung down, never above the body's own material, and
 *                strictly under the cover it is a hole in. Measured in SWINGS
 *                through the shipped solver, not asserted about the table.
 *   COMPOSED     the spatial opening and the temporal one both end at
 *                `_turnCut` returning false, and neither is the other. Driven
 *                through the real method on a real body, all four cells of the
 *                grid: guard × gap.
 *   BILLED ONCE  a gap sits INSIDE the capsule of the bone it is a hole in, so
 *                the solver has to charge one of them and not both.
 *   LEGIBLE      a pass through a gap says so, on the same channel that already
 *                says 'HIDE TURNS IT' for a pass that lands anywhere else.
 *
 * Every list of bodies below is enumerated from `ARCHETYPES` through
 * `hasWeakPoints`, which is the shipped predicate; a roster typed here is the
 * defect the whole area is about.
 */

import * as THREE from 'three';
import { Enemy, ARCHETYPES, enemyRng, guardFor, hasWeakPoints, severanceOf, AXIAL_ROLES, TURNED_CUT }
  from '../../src/game/Enemy.js';
import { TOUGHNESS, thinner, BladeContactSolver } from '../../src/game/Combat.js';
import { weakSpotsOf } from '../../src/game/Bodies.js';
import * as PHYS from '../../src/physics/RapierWorld.js';
import '../../src/game/Levels.js';        // registers the menagerie and the machines
import '../../src/game/Vehicles.js';      // …and the four machines built outside Bodies.js

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Every archetype the shipped predicate says can carry a weak point. */
const GUARDED = Object.keys(ARCHETYPES)
  .filter((t) => typeof ARCHETYPES[t].build === 'function' && hasWeakPoints(ARCHETYPES[t]));

const terrain = {
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
};
const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
  spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} } };

/**
 * A real `Enemy` on a flat field, and the floating text it raises is CAPTURED.
 *
 * Same shape as severance.mjs's `live`, with one difference that is the whole
 * point of one of the checks below: `notifyFloating` records instead of
 * swallowing, so "the game says so" can be measured rather than asserted about
 * the source. `enemyRng` is seeded because building an Enemy draws from it —
 * see determinism.mjs.
 */
function live(type) {
  enemyRng.seed(4711);
  const said = [];
  const w = {
    scene: new THREE.Scene(),
    physics: new PHYS.RapierWorld({ gravity: -24, iterations: 4, maxBodies: 96 }),
    terrain, statics: [], settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [], particles,
    bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, addHitstop() {},
    notifyFloating(p, text, colour) { said.push({ text, colour }); },
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  w.physics.terrain = terrain;
  const e = new Enemy(w, type, V(0, 0, -6));
  w.enemies.push(e);
  e.update(1 / 60, { enemies: w.enemies, particles, terrain, physics: w.physics,
    bolts: w.bolts, time: 0, pickTarget: () => null, camera: w.engine.camera });
  e.said = said;
  return e;
}

/** One capsule per body, cached, with the body disposed straight after. */
const _caps = new Map();
function capsOf(type) {
  if (_caps.has(type)) return _caps.get(type);
  const e = live(type);
  // The array is recycled between calls and its entries are minted fresh, so
  // the entries survive the body and the array must not (Waves.js says the same
  // thing at its own call site).
  const out = e.capsules().map((c) => ({ ...c, enemy: null }));
  const roles = new Map();
  /* WHICH BONES CARRY A LIMB PLATE, which is the only thing the derivation in
   * `weakSpotsOf` can read. Not the same question as "which bones are not
   * axial": an AAT's prow and stern are `hull` — non-axial, and no more a limb
   * than its turret is. */
  const plated = new Set();
  /* …AND WHICH BONES CARRY A SPOT SOMEBODY STATED OUT LOUD. `bone.weak` is
   * where `weakSpot` puts a declaration, and it is the other half of the
   * question "where could this gap have come from" — the AAT's intakes, the
   * Juggernaut's ten axle housings and the NR-N99's two drive sprockets are all
   * declared rather than derived, because none of them is a plate's leftover
   * and there is no plate to strap to a wheel. */
  const declared = new Set();
  for (const b of (e.rig?.list ?? [])) {
    roles.set(b.name, b.role);
    if (b.plateFrom !== undefined) plated.add(b.name);
    if (b.weak && b.weak.length) declared.add(b.name);
  }
  e.dispose?.();
  const v = { caps: out, roles, plated, declared, A: ARCHETYPES[type] };
  _caps.set(type, v);
  return v;
}

const gapsIn = (caps) => caps.filter((c) => c.covers);

/** One pass of a real blade across a capsule: how many swings to complete it. */
function swingsFor(scene, cap, speed, reach, budget = 24) {
  const solver = new BladeContactSolver();
  const { Saber } = SABER;
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: reach });
  try {
    saber.ignite(); saber.ignition = 1;
    const q = new THREE.Quaternion();
    // You cannot cut deeper than the blade is long — balance.mjs's `workCapsule`
    // caps the same way and for the same reason: a walker's 1.6 m body radius
    // would otherwise hold the blade in contact for 3.2 m of travel per pass.
    const r = Math.min(cap.r, reach / 2);
    const half = Math.max(cap.p0.distanceTo(cap.p1) / 2, 0.02);
    const tgt = { id: 't', dead: false,
      capsules: [{ ...cap, r, p0: V(0, 1.2, -half), p1: V(0, 1.2, half) }] };
    const dt = 1 / 60, span = Math.max(1.2, 2 * r + 0.6), period = 0.8, travel = span / speed;
    let t = 0, swings = 0, last = -1;
    for (; t < budget; t += dt) {
      const ph = t % period, n = Math.floor(t / period);
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
let SABER = null;
let CELMOD = null;

export async function run({ check, assert }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();
  SABER = await import('../../src/game/Saber.js');
  CELMOD = await import('../../src/toon/Cel.js');

  check('weak points: the bodies that have a hide to have a gap in, and no others', () => {
    /**
     * `hasWeakPoints` is `guardFor(A) > 0 && !A.saber`, and the reason it is
     * that and not a new list is that it is the SAME boundary the hide guard
     * already draws. The spatial opening exists exactly where the temporal one
     * does. Asserted in both directions, because a predicate that quietly
     * widened would put a soft spot on a B1 and one that narrowed would take
     * the feature off the roster without failing anything.
     */
    const all = Object.keys(ARCHETYPES).filter((t) => typeof ARCHETYPES[t].build === 'function');
    for (const t of all) {
      const A = ARCHETYPES[t];
      const want = guardFor(A) > 0 && !A.saber;
      assert(hasWeakPoints(A) === want,
        `${t}: hasWeakPoints says ${hasWeakPoints(A)} against guard ${guardFor(A)} `
        + `and saber ${!!A.saber} — the two boundaries have come apart`);
      if (!want) {
        assert(gapsIn(capsOf(t).caps).length === 0,
          `${t} carries weak points with guard ${guardFor(A)} and saber ${!!A.saber}. `
          + 'A body that comes apart on the first pass anywhere does not need a soft place.');
      }
    }
    const big = all.filter((t) => ARCHETYPES[t].big);
    const missing = big.filter((t) => !hasWeakPoints(ARCHETYPES[t]));
    assert(!missing.length, `${missing.join(', ')} are \`big\` and cannot carry a weak point`);
    return `${GUARDED.length} bodies can carry one (${GUARDED.join(', ')}); `
      + `${all.length - GUARDED.length} cannot and none does`;
  });

  check('weak points: a plated limb has a joint where the plate stops — derived, not listed', () => {
    /**
     * THE DERIVATION ITSELF. `limbPlate` records the union of the spans it
     * covered; `weakSpotsOf` turns what is left into the two ends a limb bends
     * at. If that ever silently stops working — a builder switches to a hand-
     * placed `arcGeo`, the record is cleared by a later pass — every gap on
     * every machine disappears and nothing else in the suite would notice,
     * because the remaining checks are all conditional on there being gaps.
     *
     * The property is stated over the BONES rather than over a body list: for
     * every guarded body, every bone whose plate does not run its whole length
     * must publish a capsule for the part it does not cover.
     */
    const rows = [];
    let plated = 0, joints = 0;
    for (const type of GUARDED) {
      const e = live(type);
      try {
        const names = new Set(e.capsules().map((c) => c.name));
        let n = 0;
        for (const b of (e.rig?.list ?? [])) {
          if (b.plateTo == null || !b.parts.length) continue;
          plated++;
          const spots = weakSpotsOf(b) || [];
          const derived = spots.filter((s) => s.key === 'root' || s.key === 'tip');
          assert(derived.length > 0,
            `${type}: '${b.name}' is plated from ${b.plateFrom.toFixed(3)} to `
            + `${b.plateTo.toFixed(3)} of ${b.length.toFixed(3)} m and publishes no joint — `
            + 'the plate\'s own leftovers are the derivation and it has stopped');
          for (const s of derived) {
            assert(names.has(`${b.name}.${s.key}`),
              `${type}: '${b.name}' derives a '${s.key}' gap that never reaches a capsule`);
            joints++; n++;
          }
        }
        if (n) rows.push(`${type} ${n}`);
      } finally { e.dispose?.(); }
    }
    assert(plated >= 8, `only ${plated} plated limbs across ${GUARDED.length} guarded bodies`);
    /* AND THE ONES WITH NONE, NAMED IN THE OUTPUT OF EVERY RUN. `src/game/
     * Vehicles.js` builds its four machines from `plateGeo` and `bandGeo`
     * directly and never calls `limbPlate`, so the derivation has nothing to
     * read and the AAT, the AT-TE, the hailfire and the dwarf spider have no
     * soft place at all. That is a real hole and it is a hole in a file this
     * workstream does not own; printing it here is what keeps it from being
     * forgotten, and the assertion above is what keeps the ones that do work
     * working. */
    const none = GUARDED.filter((t) => gapsIn(capsOf(t).caps).length === 0);
    return `${joints} joints derived off ${plated} plated limbs (${rows.join(', ')})`
      + (none.length ? ` · NO GAPS: ${none.join(', ')} — Vehicles.js never calls limbPlate` : '');
  });

  check('weak points: a gap is thinner than the cover, and never tougher than the body', () => {
    /**
     * `thinner()` is one rung down the TOUGHNESS ladder and the floor is the
     * archetype's own material. Both halves matter and they fail in opposite
     * directions: without the rung a gap is decoration, and without the floor a
     * creature's belly comes out at `armour` — five times tougher than the
     * animal's own leg, on the softest part of it.
     *
     * The ladder is imported and walked, not transcribed: a check with its own
     * copy of the material table is the twin this whole area exists to be rid
     * of (HANDOFF §2.3).
     */
    const rows = [];
    let n = 0;
    for (const type of GUARDED) {
      const { caps, A } = capsOf(type);
      const byName = new Map(caps.map((c) => [c.name, c]));
      for (const g of gapsIn(caps)) {
        const host = byName.get(g.covers);
        assert(host, `${type}: '${g.name}' covers '${g.covers}', which is not a capsule`);
        assert(g.toughness < host.toughness,
          `${type}: '${g.name}' is ${g.toughness} against the ${host.toughness} of the `
          + `'${g.covers}' it is a hole in — a gap that is not thinner is not a gap`);
        assert(g.toughness <= (A.toughness ?? TOUGHNESS.flesh),
          `${type}: '${g.name}' is ${g.toughness}, tougher than the ${A.toughness} the body `
          + 'is made of. A hole in a cover exposes what is under the cover.');
        assert(g.toughness === Math.min(thinner(host.toughness), A.toughness ?? TOUGHNESS.flesh),
          `${type}: '${g.name}' is ${g.toughness}, which is not one rung down from `
          + `${host.toughness} floored at ${A.toughness} — a second rule has appeared`);
        n++;
      }
      const gaps = gapsIn(caps);
      if (gaps.length) {
        rows.push(`${type} ${gaps.length}× ${gaps[0].toughness} under `
          + `${byName.get(gaps[0].covers).toughness}`);
      }
    }
    assert(n >= 40, `only ${n} gap capsules across the roster`);
    return `${n} gaps · ${rows.join(' · ')}`;
  });

  check('weak points: a gap costs what the BONE costs — it is a route in, not a bonus', () => {
    /**
     * The one thing a weak point must NOT be. `takeCut` bills a sever at
     * `maxHp * vital * SEVER_LETHALITY` and `World.grindWorth` bills the grind
     * that leads up to it at the same `vital`, so a gap carrying anything but
     * its host bone's price would be a damage multiplier wearing a capsule —
     * which is exactly the thing the note over `thinner` in Combat.js argues
     * against building. Aiming buys TIME and consequence, never a bigger
     * number.
     *
     * It also keeps `severance`'s cost/worth invariant true by construction:
     * every capsule with `vital < 0.9` must cost the same multiple of what it
     * is worth, and a gap priced differently from its bone would break it on a
     * body nobody thought to look at.
     */
    let n = 0;
    for (const type of GUARDED) {
      const e = live(type);
      try {
        const byName = new Map(e.capsules().map((c) => [c.name, c]));
        for (const b of (e.rig?.list ?? [])) {
          for (const s of (weakSpotsOf(b) || [])) {
            const g = byName.get(`${b.name}.${s.key}`);
            if (!g) continue;
            assert(g.vital === severanceOf(b),
              `${type}: '${g.name}' is priced ${g.vital} against the ${severanceOf(b)} of the `
              + 'bone it takes off — a gap must cost what the bone costs');
            n++;
          }
        }
      } finally { e.dispose?.(); }
    }
    assert(n >= 40, `only ${n} gaps priced`);
    return `${n} gaps, every one at its own bone's price`;
  });

  check('weak points: the gap is where the geometry is', () => {
    /**
     * "A spot nobody can find is not a mechanic", and the first way to have one
     * is to put the capsule somewhere the model is not. Every spot is declared
     * in the bone's own local frame out of the numbers that place a mesh, so
     * the test is that both ends of every gap capsule land inside the world
     * bounding box of the geometry hanging on that bone — a mis-signed offset,
     * a forgotten scale or the wrong rotation all put it outside immediately.
     *
     * The box is the bone's OWN parts and not the whole body, which is what
     * makes it a real test: an acklay is six metres across and almost anything
     * lands inside its overall box.
     */
    const rows = [];
    let n = 0, worst = 0, worstAt = '';
    for (const type of GUARDED) {
      const e = live(type);
      try {
        const caps = e.capsules();
        const gaps = gapsIn(caps);
        if (!gaps.length) continue;
        e.rig.root.updateMatrixWorld(true);
        for (const g of gaps) {
          const bone = e.rig.get(g.covers);
          const box = new THREE.Box3();
          for (const p of bone.parts) box.expandByObject(p);
          // Everything the Kit merged onto this bone counts too — the belly and
          // the intake are Kit meshes, not `bone.parts`.
          for (const c of bone.obj.children) if (!c.userData.boneChild) box.expandByObject(c);
          assert(!box.isEmpty(), `${type}: '${g.covers}' has no geometry to be a hole in`);
          for (const p of [g.p0, g.p1]) {
            const d = box.distanceToPoint(p);
            if (d > worst) { worst = d; worstAt = `${type} ${g.name}`; }
            assert(d <= g.r,
              `${type}: '${g.name}' has an end ${d.toFixed(3)} m outside the geometry on `
              + `'${g.covers}' (radius ${g.r.toFixed(3)} m) — the capsule and the mesh have `
              + 'come apart, so the spot is not where the body shows it');
          }
          n++;
        }
        rows.push(`${type} ${gaps.length}`);
      } finally { e.dispose?.(); }
    }
    assert(n >= 40, `only ${n} gaps measured against their own geometry`);
    return `${n} gaps all inside the mesh they are a hole in · worst ${worst.toFixed(3)} m `
      + `(${worstAt}) · ${rows.join(', ')}`;
  });

  check('weak points: the cel-shaded body can show the spot, and does', () => {
    /**
     * THE OTHER HALF OF "A SPOT NOBODY CAN FIND IS NOT A MECHANIC", and it is
     * the half that has to be true BEFORE the player swings rather than after.
     *
     * A weak point is a place a cover does not reach, so on screen it is the
     * bone's own tube showing between two plates — and it is only findable if
     * the tube and the plate are different colours. They are, on every body,
     * and not because anyone arranged it here: a walker's legs are `metalMat`
     * tubes under `armorMat` plates and a creature's are `hideMat` under
     * chitin, which is a decision the builders took about how a machine and an
     * animal are put together, long before any of this.
     *
     * THE BAR IS THE SHIPPED POSTERISER'S, not a taste. `CEL.albedoBands`
     * quantises albedo to five flat fields, so a band is 0.2 wide; two colours
     * an offset apart land in different fields with probability Δ/w, which
     * makes half a band the point where a difference is as likely to survive
     * the posterise as to be swallowed by it. Anything under that is a spot
     * that may render as one flat colour with the plate beside it.
     *
     * Measured on the shipped bodies, the tightest pair on the roster is the
     * spider walker's leg at 0.184 — nearly a whole band — and the widest is an
     * acklay's belly at 0.888.
     */
    const { CEL } = CELMOD;
    const floorD = 0.5 / CEL.albedoBands;
    const rows = [];
    let worst = Infinity, worstAt = '';
    for (const type of GUARDED) {
      const A = ARCHETYPES[type];
      const built = A.build({ scale: A.scale });
      if (!built.rig) continue;
      for (const b of built.rig.list) {
        if (!weakSpotsOf(b)) continue;
        const bare = b.primary && b.primary.material && b.primary.material.color;
        assert(bare, `${type}: '${b.name}' has a weak point and no primary material to show it in`);
        // Everything the Kit merged onto this bone: the plates, the ram, the
        // belly, the intake louvres. One mesh per material, which is exactly
        // the granularity the question is asked at.
        let best = 0, hex = null;
        for (const c of b.obj.children) {
          if (c.userData.boneChild || c === b.primary || !c.material || !c.material.color) continue;
          const o = c.material.color;
          const d = Math.hypot(o.r - bare.r, o.g - bare.g, o.b - bare.b);
          if (d > best) { best = d; hex = `#${o.getHexString()}`; }
        }
        assert(best >= floorD,
          `${type}: the cover on '${b.name}' is ${best.toFixed(3)} from the tube under it in `
          + `linear RGB, inside the ${floorD.toFixed(2)} that ${CEL.albedoBands} albedo bands `
          + 'can swallow — the gap and the plate would posterise to one flat field and there '
          + 'would be nothing on screen to aim at');
        if (best < worst) { worst = best; worstAt = `${type}/${b.name}`; }
        rows.push(`${type} ${b.name} #${bare.getHexString()} vs ${hex} Δ${best.toFixed(2)}`);
      }
    }
    assert(rows.length >= 20, `only ${rows.length} bones with a spot were measured`);
    return `${rows.length} spots, all clear of the ${floorD.toFixed(2)} a ${CEL.albedoBands}-band `
      + `posterise can swallow · tightest ${worst.toFixed(3)} at ${worstAt}`;
  });

  check('weak points: the spatial opening and the temporal one compose, and neither is the other', () =>
    (async () => {
      /**
       * THE HEADLINE, and all four cells of the grid driven through the real
       * `_turnCut` on a real body.
       *
       *                        guard UP            guard OPEN (winded)
       *     plate              turned              lands
       *     gap in a LIMB      lands               lands
       *     gap in a TRUNK     turned              lands
       *
       * The bottom row is the part that keeps this from being a shortcut rather
       * than an opening: `_turnCut`'s own argument is that the guard is the
       * body's bulk — "how much animal is between the edge and the spine" — so
       * a bare hinge has nothing behind it and a belly has the whole animal. A
       * core capsule is `vital` 1.0 and `takeCut` kills outright at 0.9, so
       * without that row one stifle pass would take an acklay's neck.
       *
       * And the fifth property, which is the one that makes them compose rather
       * than compete: a pass through a gap must NOT open the guard for the next
       * pass. `_turnCut`'s own note records that costing the whole guard 0.42 s
       * the first time, when a turned pass called `stun()`.
       */
      const rows = [];
      for (const type of GUARDED) {
        const probe = capsOf(type);
        const gaps = gapsIn(probe.caps);
        if (!gaps.length) continue;
        const limbGap = gaps.find((g) => g.opens);
        const axialGap = gaps.find((g) => !g.opens);
        /**
         * A BODY WITH LIMBS MUST HAVE LIMB GAPS — and a body with none may not.
         *
         * The derivation reads what a LIMB PLATE left uncovered, so on anything
         * with legs a gap list that is all trunk means it silently found
         * nothing and the declared belly is carrying the whole feature. That is
         * the failure this clause is for.
         *
         * The AAT is the honest exception and it is not an exception list: a
         * hovertank has no limbs at all, so its only soft places are the six
         * intakes in the repulsorlift skirt, declared on the line that builds
         * them. They sit on an axial bone and are therefore STILL TURNED by the
         * guard — which is the right reading, because an intake is thin metal
         * and not an open joint. What it buys is speed through the material and
         * a reason to get behind the thing, and the row below asserts exactly
         * that of every axial gap on every body.
         */
        /**
         * ── AND A LIMB GAP MAY BE DECLARED RATHER THAN DERIVED, WHICH THE
         *    `else` ARM USED TO CALL A DEFECT ──────────────────────────────
         *
         * The reasoning above is about the DERIVATION — no plate, nothing for
         * `weakSpotsOf` to leave uncovered, so a limb gap on an unplated body
         * meant the plate span had been lost. That was true while the only
         * bodies with limbs were bodies with limb plates on them, and the
         * giants broke it in a way that is correct rather than accidental:
         *
         *   the HAVw A6's ten road wheels are `leg` bones with a tyre at the
         *     tip and bare axle between, and there is no plate to strap to a
         *     wheel. The axle housing is declared on the line that positions
         *     the tyre;
         *   the NR-N99 runs on ONE tread, and its two drive sprockets are
         *     declared off the same z the sprocket groups are placed at.
         *
         * Both are the AAT's argument moved onto a limb: a soft place a builder
         * states out loud, out of the numbers that place the geometry, so the
         * capsule cannot drift from the mesh. What the arm has to ask is
         * therefore whether every limb gap is ACCOUNTED FOR — by a plate on
         * that bone, or by a declaration on it — and not whether a plate
         * exists somewhere on the body. `bone.weak` is where a declaration
         * lands, and `probe.declared` is read off it rather than off a list of
         * machine names.
         */
        const plated = [...probe.plated].filter((n) => !AXIAL_ROLES.includes(probe.roles.get(n)));
        if (plated.length) {
          assert(limbGap,
            `${type} carries a limb plate on ${plated.join(', ')} and not one of its ${gaps.length} `
            + 'gaps is on a limb — the derivation found nothing and a declared trunk gap is '
            + 'carrying the whole feature');
        } else if (limbGap) {
          assert(probe.declared.has(limbGap.covers),
            `${type} has a gap on limb '${limbGap.covers}' with neither a plate nor a declaration `
            + 'on that bone — the derivation has lost a plate span');
        } else {
          assert(axialGap, `${type} has ${gaps.length} gaps and none of them anywhere`);
        }
        for (const g of gaps) {
          const role = probe.roles.get(g.covers);
          assert(g.opens === !AXIAL_ROLES.includes(role),
            `${type}: '${g.name}' is on a '${role}' bone and opens=${g.opens} — the split is `
            + 'supposed to be AXIAL_ROLES and nothing else');
        }

        const cut = (e, cap) => e.takeCut({ bone: cap.covers ?? cap.name, cap, cutT: 0.5,
          point: e.position.clone().setY(1), impulse: V(0, 0, -1) }, null);
        const fresh = (fn) => { const e = live(type); try { return fn(e); } finally { e.dispose?.(); } };
        const capNamed = (e, name) => e.capsules().find((c) => c.name === name);

        /* THE LIMB ROWS OF THE GRID NEED A LIMB, and one body on the roster
         * has none: an AAT is a hull on a repulsorlift and its only soft
         * places are the intakes, which are axial and are covered by the trunk
         * row below on its own. Skipping the rows a body cannot have is not
         * skipping the body — the axial row above already ran, and the census
         * clause elsewhere in this file is what stops a body from quietly
         * having no gaps at all. */
        // A gap on the trunk, guard up: still turned. Run BEFORE the limb rows,
        // so a body whose only gaps are axial still exercises it.
        let c = null;
        if (axialGap) {
          c = fresh((e) => cut(e, capNamed(e, axialGap.name)));
          assert(c === 'turned',
            `${type}: a pass through '${axialGap.name}' went straight through the guard. `
            + 'A soft place on a trunk still has the whole body behind it.');
        }

        if (!limbGap) { rows.push(`${type} hull-only (${gaps.length} axial)`); continue; }

        // A fight-ending plate pass, guard up: turned.
        const plate = probe.caps.find((c) => !c.covers && !c.shield
          && c.name === limbGap.covers);
        const a = fresh((e) => cut(e, capNamed(e, plate.name)));
        assert(a === 'turned',
          `${type}: a pass at '${plate.name}' with a guard of ${guardFor(probe.A)} was not turned `
          + '— the guard this composes with has stopped working');

        // The same body, the same bone, through its gap: lands.
        const b = fresh((e) => cut(e, capNamed(e, limbGap.name)));
        assert(b !== 'turned',
          `${type}: a pass through '${limbGap.name}' was turned. A joint is where the bulk `
          + 'the guard is made of is not.');

        // The plate again, with the opening the player earns: lands.
        const d = fresh((e) => { e.state = 'winded'; return cut(e, capNamed(e, plate.name)); });
        assert(d !== 'turned',
          `${type}: WINDED no longer lets a pass at '${plate.name}' through — the temporal `
          + 'opening has been broken by the spatial one');

        /**
         * …and the gap does not become a STATE.
         *
         * Two halves, and the first one is the one that was written wrong the
         * first time. A landed cut has ALWAYS stunned the body — `takeCut`
         * calls `stun(0.4, …)` on the way out and `_guardOpen` reads
         * `stunTimer` — so the pass immediately after ANY sever lands, and
         * asserting otherwise was asserting against something the weak point
         * did not do. The property that belongs here is that once that stun has
         * run out on the game's own clock, the guard is exactly where the gap
         * pass found it: a weak point is a place on the body, and a place
         * cannot be spent.
         */
        const after = fresh((e) => {
          const g0 = e.guard;
          cut(e, capNamed(e, limbGap.name));
          const spent = g0 - e.guard;
          // Let the sever's own stagger run out — the game's timer, stepped by
          // the game's update, not zeroed by hand.
          for (let i = 0; i < 240 && e._guardOpen(); i++) {
            e.update(1 / 60, { enemies: [e], particles, terrain, physics: e.world.physics,
              bolts: e.world.bolts, time: i / 60, pickTarget: () => null,
              camera: e.world.engine.camera });
          }
          const open = e._guardOpen();
          const still = e.dead ? 'dead' : cut(e, capNamed(e, plate.name));
          return { still, spent, open, dead: e.dead, floored: !!(e.toppled && e.legsLost) };
        });
        assert(after.spent === 0,
          `${type}: the gap pass spent ${after.spent} of the guard — a pass the guard never `
          + 'touched must not cost it anything, or the spatial opening is quietly buying the '
          + 'temporal one');
        /**
         * ── AND A BODY ON THE GROUND IS NOT "IN AN OPENING" ────────────────
         *
         * Both clauses below ask whether the guard closes again once the
         * sever's own stagger has run out, and both were written against
         * bodies that get back up. Two machines on the roster do not, by
         * design: `toppleAt` is 1 for the Octuptarra magna tri-droid — the
         * reference is explicit that one damaged leg puts the whole droid over
         * — and 1 for the NR-N99, which runs on a single tread. `Enemy.recover`
         * says the rest in as many words: "a walker losing its legs is NOT
         * recoverable", so `toppled && legsLost` is permanent and
         * `_guardOpen()` is true forever after.
         *
         * That is not the failure these clauses are for. The failure they are
         * for is a WEAK POINT that leaves the guard open behind it — a place on
         * the body turning into a state the player can bank. A tripod lying on
         * its side has not banked a state, it has lost the argument: the pass
         * took the thing it was standing on, which is the counter-play its own
         * databank page names. `floored` is that outcome, and it is read off
         * the two fields the game sets rather than off a list of machine names,
         * so the next body that goes down on one leg is covered the day it is
         * written.
         */
        assert(after.dead || after.floored || !after.open,
          `${type}: the body never came out of the opening the sever gave it in 4 s`);
        assert(after.dead || after.floored || after.still === 'turned',
          `${type}: with the sever's own stagger run out, a plate pass still landed — the weak `
          + 'point has left the guard open behind it. A weak point is a place, not a state.');

        rows.push(`${type} plate=turned gap=${b === 'turned' ? 'TURNED' : 'lands'}`
          + (axialGap ? ` trunk=turned` : '') + ` winded=lands`
          + (after.floored ? ' (and the sever floored it for good)' : ''));
      }
      assert(rows.length >= 6, `only ${rows.length} bodies had a gap to compose with`);
      return rows.join(' · ');
    })());

  check('weak points: the blade goes THROUGH faster, measured in swings', () => {
    /**
     * The toughness half, driven through the shipped `BladeContactSolver`
     * rather than read off the table it is charged from — `rush`, `softness`
     * and `coverage` all move with the material and the arithmetic of how they
     * compound is the solver's, not this file's.
     *
     * Measured on the shipped bodies at the authored pass speed:
     *
     *     walker femur   plate 6 swings → joint 1     6.0×
     *     walker tibia   plate 8 swings → joint 2     4.0×
     *     walker hull    plate 11 swings → intake 5   2.2×
     *     creature trunk plate 4 swings → belly 1     4.0×
     *     creature femur plate 1 swing → joint 1      1.0×
     *
     * The last row is the honest one and it is why the guard clause above
     * exists: a creature's limbs are already `flesh` and already come apart in
     * one pass, so on those bodies the thinner material buys nothing and the
     * whole of the reward is that the pass is not turned. The bound below is
     * therefore "no gap is SLOWER, and at least one on the roster is much
     * faster", which is the property that is true of both kinds of body.
     */
    const B = SWING;
    const scene = new THREE.Scene();
    const rows = [];
    let best = 1, tested = 0;
    for (const type of GUARDED) {
      const { caps } = capsOf(type);
      const byName = new Map(caps.map((c) => [c.name, c]));
      // One of each SHAPE of gap per body — `femur0.tip` and `femur3.tip` are
      // the same measurement four times over.
      const seen = new Set();
      for (const g of gapsIn(caps)) {
        const shape = g.name.replace(/\d+/g, '#');
        if (seen.has(shape)) continue;
        seen.add(shape);
        const host = byName.get(g.covers);
        const sg = swingsFor(scene, g, B.passSpeed, B.reach);
        const sh = swingsFor(scene, host, B.passSpeed, B.reach);
        assert(isFinite(sg), `${type}: '${g.name}' never parts at all in 24 s of swinging`);
        assert(sg <= sh,
          `${type}: '${g.name}' takes ${sg} swings against the ${sh} of the '${g.covers}' it is `
          + 'a hole in. A thin place that is slower is not a thin place.');
        if (sh / sg > best) best = sh / sg;
        rows.push(`${type} ${shape} ${sh}→${sg}`);
        tested++;
      }
    }
    assert(tested >= 8, `only ${tested} distinct gap shapes on the roster`);
    assert(best >= 3,
      `the best gap on the roster saves only ${best.toFixed(2)}× the swings — a reward for `
      + 'aiming that small is not one a player can feel');
    return `${tested} gap shapes, best ${best.toFixed(1)}× · ${rows.join(' · ')}`;
  });

  check('weak points: one pass through a gap bills one bone, not two', () => {
    /**
     * A gap sits INSIDE the capsule of the bone it is a hole in — it has to, or
     * it could not have a budget of its own — so a blade in the gap is
     * geometrically inside both. Without `BladeContactSolver`'s `taken` list
     * that is two grind events a frame against the same flesh, and then two
     * severs of the same bone.
     *
     * Driven with the real solver against the real capsules, in the pose the
     * body is actually standing in, so the overlap is the shipped one.
     */
    const scene = new THREE.Scene();
    const { Saber } = SABER;
    const rows = [];
    for (const type of GUARDED) {
      const e = live(type);
      try {
        const gaps = gapsIn(e.capsules());
        if (!gaps.length) continue;
        const g = gaps[0];
        const solver = new BladeContactSolver();
        const saber = new Saber(scene, { colorIndex: 0, bladeLength: SWING.reach });
        try {
          saber.ignite(); saber.ignition = 1;
          const q = new THREE.Quaternion();
          // Straight through the middle of the gap, along its own axis's normal.
          const mid = g.p0.clone().lerp(g.p1, 0.5);
          const dt = 1 / 60;
          let both = 0, frames = 0, hostAlone = 0, gapSeen = 0;
          for (let f = 0; f < 60; f++) {
            const x = -1.2 + f * 0.04;
            // The hilt goes half a blade BELOW the spot and sweeps across it,
            // so the blade's middle passes through the gap whichever way the
            // gap's own axis runs. Under the identity quaternion `Saber` points
            // its blade along +Y.
            saber.setHiltPose(V(mid.x + x, mid.y - SWING.reach * 0.5, mid.z), q);
            saber.update(dt, f * dt);
            const caps = e.capsules();
            const evs = solver.solve(saber, [{ id: e.id, dead: false, capsules: caps, enemy: e }], dt, {});
            const names = evs.map((v) => v.cap.name);
            if (names.includes(g.name)) gapSeen++;
            if (names.includes(g.name) && names.includes(g.covers)) both++;
            if (!names.includes(g.name) && names.includes(g.covers)) hostAlone++;
            if (evs.length) frames++;
          }
          assert(gapSeen > 0,
            `${type}: 60 frames of blade straight through '${g.name}' and the solver never `
            + 'reported it — the gap is unreachable, which is the one thing it must not be');
          assert(both === 0,
            `${type}: '${g.name}' and '${g.covers}' were both billed on ${both} of ${frames} `
            + 'contact frames — one pass is being charged against the same body twice');
          rows.push(`${type} ${g.name} ${gapSeen}/${frames} frames, ${hostAlone} host-only, 0 double`);
        } finally { saber.dispose(); }
      } finally { e.dispose?.(); }
    }
    assert(rows.length >= 6, `only ${rows.length} bodies were driven`);
    return rows.join(' · ');
  });

  check('weak points: the gaps are offered to the blade before the bones they are in', () => {
    /* `BladeContactSolver`'s one-bone-per-pass rule works by letting a gap CLAIM
     * its host, which only holds if the gap is tested first. That is a property
     * of the order `Enemy.capsules()` pushes them in, and an order is exactly
     * the kind of thing that survives a refactor by luck. */
    for (const type of GUARDED) {
      const { caps } = capsOf(type);
      const at = new Map(caps.map((c, i) => [c.name, i]));
      for (const g of gapsIn(caps)) {
        assert(at.get(g.name) < at.get(g.covers),
          `${type}: '${g.name}' is offered at ${at.get(g.name)}, after the '${g.covers}' it is `
          + `a hole in at ${at.get(g.covers)} — the solver will bill the plate and never the gap`);
      }
    }
    const shielded = GUARDED.filter((t) => capsOf(t).caps.some((c) => c.shield));
    for (const t of shielded) {
      const caps = capsOf(t).caps;
      assert(caps[0].shield, `${t}: a gap was offered ahead of the deflector bubble`);
    }
    return `${GUARDED.length} bodies, every gap ahead of its bone`
      + (shielded.length ? `; ${shielded.length} with a bubble still first` : '');
  });

  check('weak points: the game says so when a pass goes through one', () => {
    /**
     * "A spot nobody can find is not a mechanic."
     *
     * `_turnCut` already shouts three different sentences at a player whose
     * pass lands anywhere else on a big body — 'TURNED', 'PLATE HOLDS', 'HIDE
     * TURNS IT' — which is the game teaching that this body refuses cuts. The
     * lesson has no second half unless the other outcome is named too, and it
     * has to be on the SAME channel and anchored to the same world point or it
     * is a number in a corner rather than a property of a place.
     *
     * Measured through the real `world.notifyFloating`, with the label read off
     * the spot rather than typed here — a label typed in a check is a label
     * that can agree with a check and disagree with the game.
     */
    const rows = [];
    for (const type of GUARDED) {
      const gaps = gapsIn(capsOf(type).caps).filter((g) => g.opens);
      if (!gaps.length) continue;
      const e = live(type);
      try {
        const g = e.capsules().find((c) => c.name === gaps[0].name);
        e.said.length = 0;
        e.takeCut({ bone: g.covers, cap: g, cutT: 0.5, point: e.position.clone().setY(1),
          impulse: V(0, 0, -1) }, null);
        const said = e.said.map((s) => s.text);
        assert(said.includes(g.weak.label),
          `${type}: a pass through '${g.name}' said ${JSON.stringify(said)} and never `
          + `${JSON.stringify(g.weak.label)} — the player is not told the spot exists`);
        rows.push(`${type} '${g.weak.label}'`);
      } finally { e.dispose?.(); }
    }
    /* …and the other half of the pair still fires, so the two are learnable
     * against each other rather than one replacing the other. */
    const hide = GUARDED.find((t) => !ARCHETYPES[t].saber && gapsIn(capsOf(t).caps).length);
    const e = live(hide);
    try {
      const plate = e.capsules().find((c) => !c.covers && !c.shield && c.vital >= 0.9);
      e.said.length = 0;
      e.takeCut({ bone: plate.name, cap: plate, cutT: 0.5, point: e.position.clone().setY(1),
        impulse: V(0, 0, -1) }, null);
      assert(e.said.length > 0,
        `${hide}: a turned pass says nothing at all any more — the sentence a weak point is the `
        + 'other half of has gone');
      rows.push(`${hide} turned → '${e.said[0].text}'`);
    } finally { e.dispose?.(); }
    assert(rows.length >= 6, `only ${rows.length} bodies said anything`);
    return rows.join(' · ');
  });

  check('weak points: taking a big body apart at the joints puts it on the ground', () =>
    (async () => {
      /**
       * WHAT THE MECHANIC IS FOR, stated as the fight rather than as a number.
       *
       * Before this, on any body with a hide guard, `_fightEnding` returned true
       * for every bone — a body with no blade has no cheap limb — so EVERY leg
       * pass was turned and a player could not take a leg off a big creature at
       * all until the guard had already been beaten by something else. Measured
       * over the roster, working down one route to the kill:
       *
       *     plate route   3–5 turned passes, 0 limbs off, no topple
       *     joint route   0 turned passes, 1–4 limbs off, TOPPLED
       *
       * And a topple is `_guardOpen`, so the spatial opening BUYS the temporal
       * one, which is the whole of what "they should compose" means here.
       */
      const rows = [];
      for (const type of GUARDED) {
        const gaps = gapsIn(capsOf(type).caps).filter((g) => g.opens);
        if (!gaps.length) continue;
        const run = (pick) => {
          const e = live(type);
          try {
            let n = 0, turned = 0;
            while (!e.dead && n < 40) {
              const c = e.capsules().filter(pick)[0];
              if (!c) break;
              const r = e.takeCut({ bone: c.covers ?? c.name, cap: c, cutT: 0.5,
                point: e.position.clone().setY(1), impulse: V(0, 0, -1) }, null);
              n++; if (r === 'turned') turned++;
            }
            return { n, turned, legs: e.legsLost || 0, toppled: !!e.toppled, dead: e.dead,
              hp: e.hp, maxHp: e.maxHp };
          } finally { e.dispose?.(); }
        };
        const plate = run((c) => !c.shield && !c.covers && c.vital < 0.9);
        const joint = run((c) => c.covers && c.opens);
        assert(joint.turned === 0,
          `${type}: ${joint.turned} of ${joint.n} joint passes were turned`);
        /* THE COMPARISON IS TURNED PASSES, NOT LIMBS, and the first version of
         * this had it the other way round and failed on the pouncer. A guard of
         * ONE turns the first plate pass and then the second lands, so the
         * plate route takes a limb too — it just pays a whole pass and 24% of
         * the body for the privilege. What is true on every body is that the
         * plate route pays the guard in full (`guardFor`, capped by the five
         * turns `TURNED_CUT` allows) and the joint route pays none of it, and
         * that the joints are not a WORSE way to take a body apart. */
        assert(plate.turned === Math.min(guardFor(ARCHETYPES[type]), Math.ceil(1 / TURNED_CUT)) || plate.dead,
          `${type}: the plate route turned ${plate.turned} passes against a guard of `
          + `${guardFor(ARCHETYPES[type])} — the guard this is measured against has moved`);
        assert(joint.legs >= plate.legs,
          `${type}: working the joints took ${joint.legs} limbs off against ${plate.legs} from `
          + 'the plate beside them — the gap is not buying the thing it exists to buy');
        /**
         * ── AND IT ENDS THE FIGHT, WHICH IS TWO OUTCOMES AND NOT ONE ───────
         *
         * This asserted `joint.dead` alone, and it passed on a body that could
         * not be killed through its joints at all — because a joint on a
         * RAGDOLLED body never ran out. `Enemy.takeCut` called
         * `actor.cutRagdoll(bone, impulse)` with no stump, which breaks the
         * joint and leaves `bone.cutT` untouched, so `capsules()` went on
         * offering the same gap in the same full-length bone for ever. Driven
         * on the SPHA before that was fixed: **seventeen passes through
         * `tibia0.root`, one leg, `legsLost` 16.** Every body here "died to its
         * joints" because one joint could be chopped until the health ran out.
         *
         * With the stump passed (`cutRagdoll(bone, impulse, ev.cutT)`) a bone
         * shortens as it is worked and its declared gap eventually sits past
         * the stub, which is the same arithmetic `capsules()` already applies
         * to a standing body. Thirteen of the fourteen still die on this route.
         * The NR-N99 does not, and it is not a defect: `buildSnailTank` states
         * that the two sprockets are "the tank's only weak point because they
         * are the only place the track is not lying flat against armour", so
         * its whole joint route is ONE bone, and cutting a tread down to a
         * quarter of the hull height leaves nothing for a sprocket to be a hole
         * in. Measured after the fix: 2 passes, `legsLost` 2, TOPPLED,
         * 180 hp of 1150.
         *
         * So the bar is the CHECK'S OWN TITLE — the joints put it on the
         * ground — plus the health that came off with them, and it is STRONGER
         * than what stood here: `joint.toppled` is the claim this check is
         * named for and it was printed and never asserted.
         */
        assert(joint.dead || joint.toppled,
          `${type}: the joint route neither killed it nor put it on the ground in `
          + `${joint.n} passes`);
        assert(joint.dead || joint.hp <= joint.maxHp * 0.25,
          `${type}: the joint route ran out after ${joint.n} passes with `
          + `${joint.hp.toFixed(0)} of ${joint.maxHp} hp still on it — working the gaps has to `
          + 'end the fight, whether by the kill or by the floor');
        rows.push(`${type} plate ${plate.n}p/${plate.turned}t/${plate.legs}L`
          + ` → joint ${joint.n}p/0t/${joint.legs}L${joint.toppled ? '+topple' : ''}`
          + `${joint.dead ? '+dead' : ` (${((joint.hp / joint.maxHp) * 100).toFixed(0)}% left)`}`);
      }
      assert(rows.length >= 6, `only ${rows.length} bodies had a joint to work`);
      return rows.join(' · ');
    })());
}

/**
 * The blade's own numbers, off the harness that measures them on the real
 * controller. Imported lazily so this file does not pull tools/balance.mjs into
 * every run that only wants the capsule checks.
 */
const SWING = await (async () => {
  const B = await import('../balance.mjs');
  const m = B.measureSwing();
  /* The blade a player is actually holding. `Saber`'s own default is the
   * authority — writing 1.15 here would be a third copy of a number that
   * already exists in two places (src/game/Saber.js and Player's boon-free
   * `bladeLength`), and the swing counts below are only comparable to the game
   * if the blade is the game's. */
  const { Saber } = await import('../../src/game/Saber.js');
  const probe = new Saber(new THREE.Scene(), { colorIndex: 0 });
  const reach = probe.bladeLength;
  probe.dispose();
  return { passSpeed: m.passSpeed, reach };
})();
