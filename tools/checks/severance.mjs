/**
 * BATTLEFRONT BORZ — WHAT LOSING A BONE IS WORTH, over the whole roster.
 *
 * NOT `tools/checks/vitals.mjs`, which is about the PLAYER's hp staying finite
 * and shares nothing with this but four letters. This file is about
 * `Enemy.severance`: how lethal severing a given bone is, and whether every
 * bone on every body in the game has an answer that somebody meant.
 *
 * ── THE DEFECT THIS EXISTS TO KEEP SHUT ───────────────────────────────────
 *
 * `Enemy.capsules` priced a severed bone as `VITAL[b.name] ?? 0.4` against a
 * table of NINETEEN HUMANOID NAMES. The roster is thirty-one bodies and
 * fifty-four distinct bone names; THIRTY-FOUR of them hit the default. Since
 * `takeCut` charges `maxHp * vital * 1.15` — a share of MAXIMUM health — that
 * one number decided how many pieces every quadruped, hexapod, tank and
 * hailfire droid in the game could lose. A 2200 hp Rancor's toe was worth 46%
 * of it, exactly as much as its hip, and three of its four toes killed it.
 *
 * It survived the whole project because it was SILENT. A body plan nobody had
 * thought about got an answer that looked like an answer. So the properties
 * below are chosen to be the ones that would have gone red on the day the
 * first quadruped was authored, and none of them can be satisfied by adding a
 * row to a table:
 *
 *   COVERAGE     every archetype builds, every capsule it emits carries a
 *                price, every bone's role is in the closed vocabulary, and the
 *                price table's keys ARE that vocabulary — asserted in both
 *                directions, so neither list can grow a member the other has
 *                not got. Plus: the resolver THROWS, demonstrated rather than
 *                asserted about the source.
 *   ORDER        core ≥ head > proximal > distal > extremity, per limb, per
 *                body. A consequence of the bones rather than a rule anyone
 *                maintains, and this is what says so.
 *   REDUNDANCY   a body with more legs prices one leg lower. This is the
 *                property a name table can never have: `femur0` on a six-legged
 *                acklay and `femur0` on a two-legged rancor are spelt the same.
 *   LETHALITY    the head, the neck and the trunk stay over the 0.9 that
 *                `_fightEnding` and `takeCut` turn on. A lightsaber ends a
 *                fight by reaching something vital in one pass, and that is
 *                the design this whole table hangs off.
 *   EXTREMITIES  no body can be killed by taking its extremities off — not
 *                even ALL of them. EIGHT bodies failed it before this landed.
 *   CHAFF        and nothing under 300 kg was armoured on the way past.
 *
 * Every list of bodies, bones and roles below is ENUMERATED from the game —
 * `ARCHETYPES`, the built rig, `BONE_ROLES`, `AXIAL_ROLES` — and never typed
 * here, down to which roles count as the trunk. A check with its own copy of
 * the roster is the defect it is checking for.
 */

import * as THREE from 'three';
import { ARCHETYPES, Enemy, guardFor, severance, PRICED_ROLES, AXIAL_ROLES, SEVER_LETHALITY }
  from '../../src/game/Enemy.js';
import { GRIND_LETHALITY, grindWorth, World } from '../../src/game/World.js';
import { Rig, BONE_ROLES } from '../../src/game/Rig.js';
import * as PHYS from '../../src/physics/RapierWorld.js';
import '../../src/game/Levels.js';        // registers the Command units, machines and menagerie

/** Every archetype that can be built — found, not listed. */
const ROSTER = Object.keys(ARCHETYPES).filter((t) => typeof ARCHETYPES[t].build === 'function');

/**
 * One body, built and asked for its capsules exactly the way the game asks.
 *
 * `Enemy.capsules()` reads nothing but `this.rig`/`this.group`, `this.A` and a
 * scratch array, so it runs against a stub — which is what makes the vitals
 * here the SHIPPED ones rather than a transcription. tools/balance.mjs builds
 * the same stub for the same reason; this file keeps its own because it also
 * wants the rig, and a check that reached into the harness for a body would be
 * measuring the harness.
 */
const _bodies = new Map();
function body(type) {
  if (_bodies.has(type)) return _bodies.get(type);
  const A = ARCHETYPES[type];
  const built = A.build({ scale: A.scale });
  const rig = built.rig || (built.list ? built : null);
  rig?.root?.updateMatrixWorld?.(true);
  built.group?.updateMatrixWorld?.(true);
  const stub = {
    _caps: [], dead: false, actor: null, shieldUp: false, shieldMesh: null,
    rig, group: built.group || null, built, A,
    position: new THREE.Vector3(),
    _boneToughness: Enemy.prototype._boneToughness,
  };
  const caps = Enemy.prototype.capsules.call(stub).filter((c) => !c.shield);
  const v = { type, A, rig, caps, byName: new Map(caps.map((c) => [c.name, c])) };
  _bodies.set(type, v);
  return v;
}

/** Bodies with a rig — the 29 whose bones carry a role. The droideka and the
 *  training remote synthesise their capsules instead and are checked apart. */
const RIGGED = ROSTER.filter((t) => !!body(t).rig);

/**
 * The bones of one body, grouped by limb, in chain order — off the tree.
 *
 * A limb ROOT is a bone whose parent carries a different role, which is the
 * same rule `Rig._measureLimbs` counts with; walking down from it gives the
 * chain. Only bones that actually produced a capsule are included, because a
 * bone with no geometry on it is not a thing a blade can meet.
 */
function limbsOf(type) {
  const { rig, byName } = body(type);
  const out = [];
  if (!rig) return out;
  for (const b of rig.list) {
    if (b.parent && b.parent.role === b.role) continue;       // not a root
    if (AXIAL_ROLES.includes(b.role)) continue;
    const chain = [];
    for (let c = b; c; c = c.children.find((k) => k.role === c.role)) {
      if (byName.has(c.name)) chain.push(c);
    }
    if (chain.length) out.push({ role: b.role, chain });
  }
  return out;
}

/** The axial bones of one body that a blade can meet. */
const axialOf = (type) => body(type).caps.filter((c) => {
  const b = body(type).rig?.get(c.name);
  return b && AXIAL_ROLES.includes(b.role);
});

/**
 * HEAVY, derived rather than declared: the bodies `HIDE_PER_KG` gives a guard
 * to and that do not carry a blade — i.e. everything over 300 kg that fights
 * with its own bulk. That is the game's own line between chaff and a thing you
 * have to work at, and reading it off `guardFor` means a body added tomorrow
 * lands on whichever side of it its mass puts it.
 */
const HEAVY = ROSTER.filter((t) => !ARCHETYPES[t].saber && guardFor(ARCHETYPES[t]) > 0);
/** …and the other end of the same line. */
const CHAFF = ROSTER.filter((t) => guardFor(ARCHETYPES[t]) === 0 && !ARCHETYPES[t].training);

const pc = (v) => `${(v * 100).toFixed(1)}%`;

/** Point to capsule AXIS distance — the same segment test the solver uses. */
const _sdA = new THREE.Vector3(), _sdB = new THREE.Vector3();
function segDist(p, a, b) {
  _sdA.subVectors(b, a);
  const L2 = _sdA.lengthSq();
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, _sdB.subVectors(p, a).dot(_sdA) / L2)) : 0;
  return p.distanceTo(_sdB.copy(a).addScaledVector(_sdA, t));
}

/**
 * A REAL `Enemy` on a flat field — for the one check that has to drive the
 * shipped `takeCut` rather than reason about the numbers it reads.
 *
 * `initPhysics()` is awaited by the caller; everything else is the smallest
 * world an Enemy will construct against. Deliberately not shared with the
 * stub above: that one exists so `capsules()` can be asked cheaply about
 * thirty-one bodies, this one exists so one body can be cut apart for real.
 */
function live(type) {
  const terrain = {
    height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
    size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
    crater() {}, flush() {}, slopeAt: () => 0,
  };
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} } };
  const w = {
    scene: new THREE.Scene(), physics: new PHYS.RapierWorld({ gravity: -24, iterations: 4, maxBodies: 96 }),
    terrain, statics: [], settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  w.physics.terrain = terrain;
  const e = new Enemy(w, type, new THREE.Vector3(0, 0, -6));
  w.enemies.push(e);
  e.update(1 / 60, { enemies: w.enemies, particles, terrain, physics: w.physics,
    bolts: w.bolts, time: 0, pickTarget: () => null, camera: w.engine.camera });
  return e;
}

export async function run({ check, assert }) {

  check('severance: a blade through the DRAWN body reaches a capsule', () => {
    /**
     * ══ THE QUESTION NEITHER THIS FILE NOR `beasts.mjs` HAD EVER ASKED ══
     *
     * Both of them START from `capsules()`. Every property above is about what
     * a capsule is WORTH — its price, its role, its order down a limb — and not
     * one of them asks whether the capsule is anywhere near the thing the
     * player can see. So a bone could emit a perfectly priced capsule two and a
     * half metres from its own mesh and the whole suite would stay green.
     *
     * It did. Measured before `coverSpotOf` existed, every drawn vertex on
     * every body against the COMPLETE shipped capsule set:
     *
     *     AAT      57% of its surface outside, worst point 1.23 m out
     *     AT-TE    38%   (tarsus 70% × 6, 0.56 m)
     *     nexu     15%   (head 57%, 1.13 m)
     *     acklay    9%   (head 63%, 2.91 m — the mesh runs 4.38 m along the
     *                     bone's local +Z and the capsule 1.62 m along its +Y)
     *     dwarf spider 10%  (tarsus 100% × 4)
     *
     * and every one of the nineteen HUMANOIDS was inside its own capsules to
     * within 0.07 m, which is what says this is a creature and machine problem
     * and not a tolerance. The feet are the ones that matter: HANDOFF 6.1c's
     * whole design is that "the counter-play to a body you cannot cut through
     * is the legs it is standing on", `legsLost >= 3` topples, and 70% of a
     * walker's foot was not there to be cut.
     *
     * TWO BOUNDS, because the two say different things. The WORST GAP is about
     * a blade passing through drawn geometry and meeting nothing — an acklay's
     * head at 2.91 m is not a tolerance, it is an absence. The SHARE is about
     * how much of a body is like that.
     */
    const rows = [];
    let worstAll = 0, worstWhere = '';
    for (const type of RIGGED) {
      const { rig, caps } = body(type);
      rig.root.updateMatrixWorld(true);
      let n = 0, out = 0, worst = 0, worstBone = '';
      for (const b of rig.list) {
        if (!b.parts.length) continue;
        for (const m of b.parts) {
          const attr = m.geometry?.attributes?.position;
          if (!attr) continue;
          m.updateWorldMatrix(true, false);
          // Subsampled to about 400 points a bone: a hull with 4000 vertices
          // does not describe its own extent ten times better, and this runs
          // over 29 bodies.
          const stride = Math.max(1, Math.floor(attr.count / 400));
          for (let i = 0; i < attr.count; i += stride) {
            const q = new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(m.matrixWorld);
            let best = Infinity;
            for (const c of caps) {
              const d = segDist(q, c.p0, c.p1) - c.r;
              if (d < best) best = d;
            }
            n++;
            if (best > 0) {
              out++;
              if (best > worst) { worst = best; worstBone = b.name; }
            }
          }
        }
      }
      if (!n) continue;
      const share = out / n;
      if (worst > worstAll) { worstAll = worst; worstWhere = `${type}.${worstBone}`; }
      assert(worst < 0.20,
        `${type}: a point on the drawn '${worstBone}' is ${worst.toFixed(2)} m outside every capsule this `
        + 'body emits — a blade through it meets nothing at all');
      assert(share < 0.22,
        `${type}: ${(share * 100).toFixed(0)}% of its drawn surface is outside its own capsules`);
      rows.push(`${type} ${(share * 100).toFixed(0)}%/${worst.toFixed(2)}m`);
    }
    assert(rows.length >= 25, `only ${rows.length} rigged bodies were measured`);
    return `worst ${worstWhere} ${worstAll.toFixed(2)} m; ` + rows.join(' ');
  });

  check('severance: every bone every body can produce has a price, and nothing defaults', () => {
    const names = new Set();
    let capsules = 0;
    for (const type of ROSTER) {
      const { caps, rig } = body(type);
      assert(caps.length > 0, `${type} produced no capsules at all — a body the blade cannot meet`);
      for (const c of caps) {
        names.add(c.name);
        capsules++;
        assert(typeof c.vital === 'number' && isFinite(c.vital) && c.vital > 0,
          `${type}'s '${c.name}' capsule carries vital=${JSON.stringify(c.vital)}. `
          + 'A capsule with no price is what `?? 0.4` used to answer.');
        assert(c.vital <= 1, `${type}'s '${c.name}' is priced at ${c.vital} — over a whole body`);
      }
      if (!rig) continue;
      for (const b of rig.list) {
        assert(BONE_ROLES.includes(b.role),
          `${type}'s bone '${b.name}' has role ${JSON.stringify(b.role)}, outside the vocabulary`);
        assert(b.roleOf >= 1 && b.roleShare > 0 && b.roleShare <= 1,
          `${type}'s '${b.name}' measured roleShare ${b.roleShare} of ${b.roleOf}`);
      }
    }
    return `${ROSTER.length} archetypes, ${capsules} capsules, ${names.size} distinct bone names, `
      + 'every one priced';
  });

  check('severance: the vocabulary and the price list are the same set, in both directions', () => {
    /* THE §2.3 TRIPWIRE, and it is the whole reason this is two lists rather
     * than one: `Rig.BONE_ROLES` is what a skeleton may declare and
     * `Enemy.PRICED_ROLES` is what has a price, and the failure mode of the
     * table this replaces was a member of the first with no member of the
     * second. Asserted BOTH ways: a priced role nothing declares is a dead
     * entry, which is how a table starts drifting in the other direction. */
    const missing = BONE_ROLES.filter((r) => !PRICED_ROLES.includes(r));
    const orphan = PRICED_ROLES.filter((r) => !BONE_ROLES.includes(r));
    assert(!missing.length, `roles a bone may declare with no price: ${missing.join(', ')}`);
    assert(!orphan.length, `priced roles no bone may declare: ${orphan.join(', ')}`);
    return `${BONE_ROLES.length} roles: ${BONE_ROLES.join(', ')}`;
  });

  check('severance: an unpriced role STOPS the game rather than being answered', () => {
    /* Demonstrated, not asserted about the source. `?? 0.4` is what let a whole
     * body plan go unpriced for the life of the project, so the property that
     * matters is not that the characters are gone — it is that the two doors an
     * unknown bone can come through are both shut, loudly, with the offending
     * value in the message. */
    let threw = null;
    try { severance('tail'); } catch (e) { threw = e; }
    assert(threw, '`severance` answered an unpriced role instead of throwing');
    assert(/tail/.test(threw.message), `the throw does not name the role: ${threw.message}`);

    let rigThrew = null;
    try {
      new Rig([{ name: 'tail', parent: null, offset: [0, 0, 0], length: 1, rest: [0, 1, 0] }]);
    } catch (e) { rigThrew = e; }
    assert(rigThrew, '`Rig` built a bone that declares no role at all');
    assert(/tail/.test(rigThrew.message), `the throw does not name the bone: ${rigThrew.message}`);

    // …and a well-formed role still works, so the guard is not simply "throw".
    assert(severance('leg', 1, 2) > 0, 'a priced role stopped answering');
    return 'both `severance` and `Rig` refuse an unknown bone by name';
  });

  check('severance: core ≥ head > proximal > distal > extremity, on every body', () => {
    const rows = [];
    for (const type of RIGGED) {
      const { rig, byName } = body(type);
      const axial = axialOf(type);
      const worstAxial = axial.length ? Math.min(...axial.map((c) => c.vital)) : 1;
      for (const { role, chain } of limbsOf(type)) {
        for (let i = 1; i < chain.length; i++) {
          const a = byName.get(chain[i - 1].name).vital, b = byName.get(chain[i].name).vital;
          assert(b < a,
            `${type}: '${chain[i].name}' (${b.toFixed(3)}) is not cheaper than the `
            + `'${chain[i - 1].name}' (${a.toFixed(3)}) it hangs off — a cut takes everything `
            + 'below it, so going distal must always take less of the body');
        }
        const top = byName.get(chain[0].name).vital;
        assert(top < worstAxial,
          `${type}: a '${chain[0].name}' at ${top.toFixed(3)} costs as much as the cheapest `
          + `axial bone (${worstAxial.toFixed(3)}). A limb is not a spine.`);
        rows.push(`${type}/${role} ${chain.map((c) => byName.get(c.name).vital.toFixed(2)).join('>')}`);
      }
    }
    assert(rows.length >= 40, `only ${rows.length} limbs measured across ${RIGGED.length} bodies`);
    return `${rows.length} limb chains, all strictly descending — e.g. ` + rows.slice(0, 3).join(' · ');
  });

  check('severance: a body with more legs prices one leg lower — the divisor is COUNTED', () => {
    /* The property no name table can hold. `femur0` is `femur0` on a rancor
     * standing on two legs and on an acklay standing on six, and losing one of
     * six is not what losing one of two is. Measured across the roster by leg
     * COUNT, so it is a statement about body plans rather than about two bodies
     * somebody picked. */
    const byCount = new Map();
    for (const type of RIGGED) {
      const { byName } = body(type);
      for (const { role, chain } of limbsOf(type)) {
        if (role !== 'leg') continue;
        const n = chain[0].roleOf;
        const v = byName.get(chain[0].name).vital;
        if (!byCount.has(n)) byCount.set(n, []);
        byCount.get(n).push({ type, v });
      }
    }
    const counts = [...byCount.keys()].sort((a, b) => a - b);
    assert(counts.length >= 3,
      `only ${counts.length} distinct leg counts on the roster — the property is untested`);
    for (let i = 1; i < counts.length; i++) {
      const lo = Math.min(...byCount.get(counts[i - 1]).map((x) => x.v));
      const hi = Math.max(...byCount.get(counts[i]).map((x) => x.v));
      assert(hi < lo,
        `a ${counts[i]}-legged body prices a leg at ${hi.toFixed(3)}, which is not below the `
        + `${lo.toFixed(3)} a ${counts[i - 1]}-legged one pays. Redundancy has to cost something.`);
    }
    return counts.map((n) => `${n} legs → ${byCount.get(n)[0].v.toFixed(3)} `
      + `(${[...new Set(byCount.get(n).map((x) => x.type))].join(',')})`).join(' · ');
  });

  check('severance: the head, the neck and the trunk stay lethal in one pass', () => {
    /* `takeCut` kills outright at `vital >= 0.9` and `_fightEnding` turns a
     * pass at the same number, so 0.9 is not a taste threshold — it is the
     * hinge the whole "a lightsaber ends a fight by reaching something vital"
     * design turns on. Flattening the table toward the middle would take it
     * out silently, which is why it is pinned per body rather than per name. */
    let axial = 0;
    for (const type of RIGGED) {
      const { rig, byName } = body(type);
      let lethal = 0;
      for (const b of rig.list) {
        if (!byName.has(b.name)) continue;
        if (!AXIAL_ROLES.includes(b.role)) continue;
        const v = byName.get(b.name).vital;
        assert(v >= 0.9,
          `${type}'s '${b.name}' is axial and priced ${v.toFixed(3)}, under the 0.9 that makes a `
          + 'pass fight-ending. Reaching the trunk or the head has to end it.');
        lethal++;
      }
      assert(lethal > 0, `${type} has no lethal bone at all — nothing to aim at`);
      axial += lethal;
    }
    return `${axial} axial bones across ${RIGGED.length} bodies, every one over 0.9`;
  });

  check('severance: nothing on the roster dies of its extremities — not even all of them', () => {
    /* THE HEADLINE. `takeCut` bills `maxHp * vital * 1.15` per sever, so a body
     * dies of a bone class when the class sums past one body. Before this,
     * every non-humanoid extremity was 0.4 → 0.46 of a body each, so EIGHT
     * archetypes could be killed by taking their toes off. Measured on the
     * shipped table against the same rigs: the walker, the dwarf spider, the
     * reek, the nexu, the RANCOR and the gundark each came to 184% of
     * themselves over four toes, and the acklay and the AT-TE to 276% over six.
     * They come to 20.9, 14.2, 16.8, 15.3, 43.2, 38.3, 24.9 and 16.8 per cent.
     *
     * Model-free on purpose. It is `takeCut`'s own arithmetic against the
     * capsules the game emits, so it cannot be argued with by a harness. */
    const rows = [];
    for (const type of RIGGED) {
      const { byName, A } = body(type);
      let sum = 0, n = 0, one = 0;
      for (const { chain } of limbsOf(type)) {
        if (chain.length < 2) continue;                 // no distal end to speak of
        const v = byName.get(chain[chain.length - 1].name).vital;
        sum += v * 1.15; n++; one = Math.max(one, v);
      }
      if (!n) continue;
      assert(sum < 1,
        `${type} (${A.hp} hp) loses ${pc(sum)} of itself to its ${n} extremities — it can be `
        + `killed by having its toes taken off, one at ${one.toFixed(3)}`);
      rows.push(`${type} ${n}×${one.toFixed(3)} = ${pc(sum)}`);
    }
    assert(rows.length >= 20, `only ${rows.length} bodies have an extremity to measure`);
    const worst = rows.slice().sort((a, b) => parseFloat(b.split('= ')[1]) - parseFloat(a.split('= ')[1]));
    return `${rows.length} bodies, worst ${worst.slice(0, 3).join(' · ')}`;
  });

  check('severance: a heavy body survives every extremity it has, through the real takeCut', () =>
    (async () => {
      /* THE SAME CLAIM AS A FIGHT, and driven through the SHIPPED code rather
       * than through a model of it: a real `Enemy`, its real `capsules()`, and
       * `takeCut` called until there is nothing left to take. So the lethality
       * clause, the guard, `_loseLimbBehaviour`, the topple and the disarm are
       * all the game's own, and this cannot disagree with it (HANDOFF §2.4).
       *
       * WINDED, because the guard is not what is being measured. It is the
       * shipped opening — `_guardOpen` lists it, `_beastBrain` enters it, and
       * its own comment calls it "the only safe time to go for a leg" — so
       * this is the fight AFTER the player has earned what the guard exists to
       * make them earn. Left guarded, a turned pass costs TURNED_CUT of maximum
       * health and five of them kill anything, so every heavy body would report
       * the same five passes whatever its bones were worth.
       *
       * WHY THIS AND NOT A TIME RATIO. The first version of this check asserted
       * that a toe route costs at least twice a trunk route, and it was wrong in
       * KIND rather than in magnitude: tools/balance.mjs states in as many words
       * that a limb being the cheap way into a big animal is the intended
       * answer — "the model discovers 'take its legs' … from the rules the game
       * already had". Measured, three of ten heavy bodies legitimately go faster
       * through a limb than through a two-metre armoured trunk. The claim worth
       * pinning is not that a toe is slow; it is that a toe is not a KILL.
       *
       * The seconds are the authored cadence's, imported from the harness that
       * measures it off the real controller rather than typed here. */
      const { initPhysics } = await import('../../src/physics/Rapier.js');
      await initPhysics();
      const B = await import('../balance.mjs');
      const cadence = B.measureSwing().attacksPerSec;
      const rows = [];
      for (const type of HEAVY) {
        const ends = new Set();
        for (const { chain } of limbsOf(type)) {
          if (chain.length >= 2) ends.add(chain[chain.length - 1].name);
        }
        if (!ends.size) continue;                       // the AAT has no limbs at all
        const e = live(type);
        try {
          const hp0 = e.hp;
          let severs = 0;
          /* ONE PASS PER EXTREMITY, and iterating the NAMES rather than looping
           * on `capsules()` is the measurement rather than bookkeeping.
           * `Actor.cut` on a LEAF bone shortens it (`bone.cutT *= t`) instead of
           * marking it severed, because half a toe is still a toe — so the same
           * stub can be chopped again and `takeCut` bills the whole bone's price
           * for it every time. That is a real property worth knowing (a Rancor
           * dies to nine chops of ONE toe, where it used to die to three) and it
           * is not what this check is about: "should not die through two toes"
           * is a question about how many toes there are. */
          for (const name of ends) {
            if (e.dead) break;
            e.state = 'winded';                         // the opening, not the guard
            const cap = e.capsules().find((c) => c.name === name);
            if (!cap) continue;                         // already gone with its parent
            e.takeCut({ bone: cap.name, cap, cutT: 0.5,
              point: e.position.clone().setY(1), impulse: new THREE.Vector3(0, 0, -1) }, null);
            severs++;
          }
          const spent = (hp0 - e.hp) / e.maxHp;
          assert(!e.dead,
            `${type} (${e.maxHp} hp) DIED after ${severs} of its ${ends.size} extremities. `
            + 'Taking a body\'s toes off has to be a thing you can do to it, not a way to kill it.');
          assert(severs === ends.size,
            `${type} offered ${severs} of ${ends.size} extremities to the blade`);
          assert(spent < 1, `${type} lost ${pc(spent)} of itself to ${severs} toes`);
          rows.push(`${type} ${severs}×toe = ${pc(spent)}, ≥${(severs / cadence).toFixed(1)}s`);
        } finally { e.dispose?.(); }
      }
      assert(rows.length >= 8, `only ${rows.length} heavy bodies had an extremity to take`);
      return rows.join(' · ');
    })());

  check('severance: nothing under 300 kg was armoured on the way past', () =>
    (async () => {
      /* The counterweight. A pass that reaches a B1's, a trooper's, a B2's or a
       * droideka's trunk still ends it on the FIRST one: `guardFor` gives them
       * nothing to turn it with, and their axial bones are over the 0.9 that
       * makes `takeCut` lethal outright. Both halves are asserted, because
       * either alone could be true while the body still took five passes. */
      const B = await import('../balance.mjs');
      const mods = { cutPower: 1, bladeLength: 1.15, attackRate: 1, moveSpeed: 1 };
      const rows = [];
      for (const type of CHAFF) {
        const A = ARCHETYPES[type];
        assert(guardFor(A) === 0, `${type} grew a guard of ${guardFor(A)} at ${A.mass} kg`);
        const lethal = body(type).caps.filter((c) => c.vital >= 0.9);
        assert(lethal.length > 0,
          `${type} has nothing over 0.9 left — a body with no lethal bone cannot be ended in a pass`);
        /* ONE BONE ENDS IT — `cuts` is how many capsules the model had to get
         * through, and the bound is 1 rather than a number of seconds. A time
         * bound here would be a measurement written down as a rule: the seconds
         * move with the blade's cadence and with how thick the body is, neither
         * of which is what "still comes apart on the first pass" means. */
        const e = B.engagementFor(type, mods, 0);
        assert(e.cuts === 1,
          `${type} now takes ${e.cuts} separate bones to finish via ${e.via} `
          + `(${e.tKill.toFixed(2)} s) — the chaff has been armoured`);
        rows.push(`${type} ${e.tKill.toFixed(2)}s ${e.via}`);
      }
      assert(rows.length >= 6, `only ${rows.length} light bodies on the roster`);
      return rows.join(' · ');
    })());

  check('severance: the two bodies with no rig are priced by the same function', () => {
    /* The droideka and the training remote synthesise their capsules in
     * `Enemy.capsules` rather than walking a rig, so there is no bone to carry
     * a role and the call site names it instead. They used to carry LITERALS —
     * `vital: 1` and `vital: 0.2` — and nothing said which of the two a third
     * rig-less body should copy. What is pinned is that they go through
     * `severance`: the core is lethal, and a droideka's three legs are a leg's
     * worth divided three ways, which is what makes losing all three fatal. */
    const rigless = ROSTER.filter((t) => !body(t).rig);
    assert(rigless.length >= 2, `expected the droideka and the remote, found ${rigless.length}`);
    const rows = [];
    for (const type of rigless) {
      const { caps } = body(type);
      const core = caps.filter((c) => c.name === 'core');
      assert(core.length === 1, `${type} has ${core.length} cores`);
      assert(core[0].vital === severance('core'),
        `${type}'s core is ${core[0].vital}, not the core price ${severance('core')}`);
      const legs = caps.filter((c) => c !== core[0]);
      for (const l of legs) {
        assert(l.vital === severance('leg', 1, legs.length),
          `${type}'s '${l.name}' is ${l.vital}, not one of ${legs.length} legs`);
      }
      rows.push(`${type} core ${core[0].vital.toFixed(2)}`
        + (legs.length ? ` + ${legs.length} legs at ${legs[0].vital.toFixed(3)}` : ''));
    }
    return rows.join(' · ');
  });

  check('severance: a completed pass costs what the BONE is worth, not what a body is', () => {
    /**
     * THE OTHER HALF OF THE SUM, and this file's own header called it the
     * bigger half while it was still broken.
     *
     * A completed pass bills twice. `World._applyBladeEvent` pays the grind
     * that leads up to the sever, and `Enemy.takeCut` pays the sever. Both are
     * shares of MAXIMUM health, so how many passes a body survives through a
     * given bone is decided by the two prices alone and its health never
     * enters into it. The grind was a flat `GRIND_LETHALITY` of max hp for
     * every capsule on every body — 55% for a toe, 55% for a torso — so
     * completing a pass ANYWHERE had spent 55% before the bone was priced at
     * all, and two completed passes killed everything in the game through
     * anything it had. Fixing the sever alone could not reach it: the sever is
     * the smaller term.
     *
     * Nothing else measures this. `cutting` measures dWork/need — the SHARE of
     * a sever done per frame — and never what that share is billed at, so the
     * whole of the defect sat under a green suite.
     *
     * Both constants are imported from the module that bills with them. A
     * transcription here would be §2.3 in a check about §2.3.
     */
    /*
     * ONLY BONES THAT ARE NOT MEANT TO BE LETHAL. `takeCut` makes anything at
     * 0.9 or over kill outright, so counting passes through those measures the
     * design rather than the billing — and the training remote is exactly one
     * capsule, its own core, worth 1.0. Its cheapest bone IS its most vital
     * one, and dying in a single pass through the whole of yourself is right.
     * The first version of this check had it failing, which is a check
     * asserting against a thing the game means.
     */
    const worst = { type: null, passes: Infinity, bone: null, vital: 0 };
    const core = [], allVital = [];
    const passesFor = (v) => (v >= 0.9 ? 1
      : Math.ceil(1 / (GRIND_LETHALITY * grindWorth({ vital: v }) + v * SEVER_LETHALITY)));
    for (const type of ROSTER) {
      const { caps } = body(type);
      if (!caps.length) continue;
      const dearest = caps.reduce((a, b) => (b.vital > a.vital ? b : a));
      core.push({ type, passes: passesFor(dearest.vital), vital: dearest.vital });
      const severable = caps.filter((c) => c.vital < 0.9);
      if (!severable.length) { allVital.push(type); continue; }
      const cheapest = severable.reduce((a, b) => (b.vital < a.vital ? b : a));
      const n = passesFor(cheapest.vital);
      if (n < worst.passes) Object.assign(worst, { type, passes: n, bone: cheapest.name, vital: cheapest.vital });
    }

    /*
     * THE PROPERTY IS PROPORTIONALITY, not a floor on passes, and two earlier
     * versions of this check got that wrong in both directions. A floor fails
     * the training remote, which is one capsule worth all of itself; and it
     * fails the DROIDEKA, whose three legs are 0.367 each — two of its three
     * legs is most of the machine, and dying to that is the game working.
     *
     * What actually broke was that a pass cost the same whatever it went
     * through. So: for every severable bone on every body, the cost of a
     * completed pass divided by what the bone is worth must be the SAME
     * number. Under a flat grind it was not — a 0.024 AT-TE toe cost 0.578 of
     * the machine and a 0.500 AAT prow cost 1.125, so cost/worth ran from 2.3
     * to 24. That ratio is the defect, stated exactly.
     */
    const ratios = [];
    for (const type of ROSTER) {
      for (const c of body(type).caps) {
        if (c.vital >= 0.9) continue;
        const cost = GRIND_LETHALITY * grindWorth(c) + c.vital * SEVER_LETHALITY;
        ratios.push({ type, name: c.name, v: c.vital, k: cost / c.vital });
      }
    }
    const lo = ratios.reduce((a, b) => (b.k < a.k ? b : a));
    const hi = ratios.reduce((a, b) => (b.k > a.k ? b : a));
    assert(hi.k - lo.k < 1e-9,
      `a completed pass costs ${lo.k.toFixed(2)}× what the bone is worth on ${lo.type}'s '${lo.name}' `
      + `and ${hi.k.toFixed(2)}× on ${hi.type}'s '${hi.name}' — a pass is being billed partly against `
      + 'the BODY, which is what made two passes through anything a kill');

    /*
     * A SECOND BOUND WAS TRIED HERE AND TAKEN OUT: "a bone worth under a fifth
     * of its body must not kill it in four passes or fewer". It failed on 34
     * bones, and every one of them was the game working — a walker shin is
     * 0.15 of a walker, so four of them is sixty per cent of the machine, and
     * a machine that has lost four legs is dead. The fifth and the four were
     * numbers chosen to sound careful and derived from nothing. The bound that
     * belongs here is the one above, which is a statement about the billing,
     * and 'no body dies of ALL its extremities' further down, which is derived
     * from the bodies themselves.
     */

    // The other direction, and it is the one a fix here could quietly break:
    // reaching something vital in ONE pass is the whole design of the blade.
    const slow = core.filter((c) => c.passes !== 1);
    assert(slow.length === 0,
      `${slow.length} bodies no longer die in one pass through their most vital capsule `
      + `(${slow.slice(0, 3).map((c) => `${c.type} ${c.passes}`).join(', ')}) — pricing the grind by `
      + 'the bone must not make a torso survive a blade through it');

    assert(grindWorth({ shield: true, vital: 1 }) === 0,
      'a deflector bubble is billing a grind against the body behind it');
    assert(grindWorth({ name: 'unpriced' }) === 0,
      'a capsule with no price bills a grind anyway — that is the silent fallback coming back');

    return `${core.length} bodies · cheapest non-vital bone survives ${worst.passes} completed passes `
      + `(${worst.type} '${worst.bone}', ${worst.vital.toFixed(3)}) · every core capsule still 1`
      + (allVital.length ? ` · ${allVital.join(', ')} is vital all through and out of scope` : '');
  });

  check('severance: a corpse pays nothing — a body already dead is not a till', () => {
    /**
     * SAWING A CORPSE PAID FULL SEVER PRICE, FOREVER.
     *
     * A ragdolled body stays a blade target on purpose — an arm should come off
     * a corpse — but the reward block in `World._applyBladeEvent` never asked
     * whether the body had been alive, and nothing downstream closes the till:
     * `Ragdoll.cutRagdoll` never sets `severed`, so `isSevered` stays false and
     * the SAME hand can be taken off without bound. Measured on the shipped
     * build, ten seconds of sawing one hand of one dead body: 53 severs billed,
     * limbsRemoved 53, score 3180, combo 53, flow +5.30 against a bar clamped
     * to 0..1 — five hundred and thirty full bars — and 318 hp of lifesteal.
     * Corpses linger for the whole Corpses budget, so it is available on every
     * body after every wave at no risk at all.
     *
     * WHY THE REST OF THIS FILE COULD NOT SEE IT. Everything above prices a
     * bone: what a sever is WORTH. Not one line asks who gets PAID, or whether
     * the thing under the blade was still fighting. The lethality tables are
     * all satisfied by a corpse — it is already dead.
     *
     * Both bodies are driven through the shipped `_applyBladeEvent`, twenty
     * identical cut events each, so the only difference between the two columns
     * is `dead`. The living column is asserted too: a fix that simply stopped
     * paying for cuts would satisfy the corpse half on its own.
     */
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const till = (dead) => {
      const out = { severs: 0, marks: 0 };
      const player = {
        isLocal: false, score: 0, limbsRemoved: 0, combo: 0, comboTimer: 0, flow: 0,
        boonMods: { lifesteal: 6, cutPower: 1 }, healed: 0,
        addFlow(v) { this.flow += v; }, heal(v) { this.healed += v; },
        camera: { addShake() {} }, saber: { color: { getHex: () => 0 } },
      };
      const e = {
        id: 'e', dead, hp: dead ? -40 : 100, maxHp: 100,
        actor: { ragdolled: dead, isSevered: () => false },
        takeCut() { out.severs++; return undefined; },   // a real sever, every time
      };
      const w = Object.assign(Object.create(World.prototype), {
        time: 0, particles: { cutFlare() {}, sparkBurst() {}, slag() {}, plasma: { spawn() {} } },
        addHitstop() {}, notifyFloating() {}, report() {}, _claim() {},
        onHitmark() { out.marks++; },
      });
      for (let i = 0; i < 20; i++) {
        w._applyBladeEvent(player, {
          type: 'cut', target: { id: 'e', enemy: e }, cap: { name: 'handL', vital: 0.05 },
          bone: 'handL', cutT: 0.5, speed: 24,
          point: V(0, 1.2, -1.5), impulse: V(1, 0, 0), normal: V(0, 1, 0),
        }, 1 / 60);
      }
      return { ...out, score: player.score, limbs: player.limbsRemoved,
        combo: player.combo, flow: player.flow, healed: player.healed };
    };

    const live = till(false), dead = till(true);
    assert(live.limbs === 20 && live.score === 1200 && live.flow > 0 && live.healed > 0,
      `twenty passes through a LIVING body paid ${live.limbs} limbs, ${live.score} score, `
      + `${live.flow.toFixed(2)} flow and ${live.healed} hp — the reward path itself is broken, `
      + 'so the corpse half below would pass for the wrong reason');
    assert(dead.severs === 20,
      `the blade stopped taking limbs off a corpse (${dead.severs} of 20 passes severed) — a body `
      + 'you have killed must still come apart; it is only the till that closes');
    assert(dead.limbs === 0 && dead.score === 0 && dead.combo === 0 && dead.flow === 0
      && dead.healed === 0,
      `sawing a CORPSE billed ${dead.limbs} limbs, ${dead.score} score, combo ${dead.combo}, `
      + `flow +${dead.flow.toFixed(2)} and ${dead.healed} hp of lifesteal across twenty passes at `
      + 'one dead hand — an unbounded score, combo and heal fountain standing after every wave');
    return `living body: ${live.limbs} limbs / ${live.score} score / +${live.flow.toFixed(2)} flow / `
      + `${live.healed} hp · corpse: ${dead.severs} limbs off, nothing paid`;
  });
}
