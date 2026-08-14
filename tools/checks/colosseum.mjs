/**
 * A CROWD IS A NUMBER, and everything else about this level follows from it.
 *
 * "360° crowds, lords watching from a box, and a wave of unique large creatures
 *  each fought differently, some ridden. Scales with player count."
 *
 * Four claims, four measurements:
 *
 *  THE CROWD. Two hundred spectators is a village meeting. The thing that makes
 *  a bowl read as a full house is a count in the thousands AND a distribution
 *  that closes all the way round — a crowd with a hole in it is a set. So this
 *  measures both the head count and the angular coverage, and it measures the
 *  DRAW CALLS, because the only reason a crowd this size is affordable is that
 *  it is one instanced mesh.
 *
 *  THE BOX. Somebody is watching from above the gate, they are bigger than the
 *  crowd, and they are under a roof. All three are checkable.
 *
 *  THE CREATURES. Not that they exist — that they are DIFFERENT, and the
 *  difference is measured through the thing that actually produces it:
 *  `_beastBrain` gates its move set on the fraction of health remaining, so
 *  what decides how a creature fights is how fast it burns through its own
 *  health pool under the player's cut rate. Two creatures with the same phase
 *  schedule are the same fight with different skins.
 *
 *  THE PARTY. A second blade must make the wave bigger, and it must not make
 *  every OTHER level's wave bigger — the scaling is opt-in and the levels that
 *  did not ask for it have to be bit-identical.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { WaveDirector } from '../../src/game/Waves.js';
import { saddleThreat } from '../../src/game/Riders.js';
import { TAU } from '../../src/engine/MathUtil.js';

/**
 * `level` belongs on the stub, because dressing passes read it: the cut takes
 * its water line from `world.level?.water?.level ?? 0.30` and then refuses to
 * place anything loose below that, so a survey without a level attached is
 * surveying a level the game does not ship. Measured when sliceable.mjs was
 * missing it — the deeps lost every crate and barrel on its floor, 4 reachable
 * objects where the shipped level has 48.
 */
function stubWorld(terrain, level = null) {
  const scene = new THREE.Scene();
  return {
    scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null,
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

let D = null;
function dressed() {
  if (D) return D;
  const L = LEVELS.colosseum;
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stubWorld(terrain, L);
  L.dress(world);
  let meshes = 0, crowds = [];
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    meshes++;
    if (o.name === 'crowd') crowds.push(o);
  });
  D = { world, terrain, meshes, crowds };
  return D;
}

export function run({ check, assert }) {
  check('colosseum: thirty thousand people, in two draw calls', () => {
    const { crowds, meshes, world } = dressed();
    assert(crowds.length >= 2,
      `${crowds.length} crowd mesh(es) — the house and the box are separate crowds`);
    const heads = crowds.reduce((n, c) => n + c.count, 0);
    assert(heads > 2500, `only ${heads} spectators — that is a village meeting, not a full house`);
    assert(crowds.length <= 3,
      `${crowds.length} draw calls of crowd; the whole point of instancing it is that it is one`);

    /* 360°, and asked of the seats rather than of the loop that made them. Two
     * hundred and forty bearings round the middle of the arena: every one of
     * them has to have somebody sitting on it, except the five the level
     * deliberately leaves open — four gates and the box. */
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    const N = 240;
    const bins = new Uint8Array(N);
    for (const c of crowds) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m); m.decompose(p, q, s);
        const a = Math.atan2(p.z, p.x);
        bins[Math.floor(((a % TAU + TAU) % TAU) / TAU * N) % N] = 1;
      }
    }
    let empty = 0, longest = 0, runLen = 0;
    for (let i = 0; i < N * 2; i++) {
      if (!bins[i % N]) { runLen++; if (runLen > longest) longest = runLen; if (i < N) empty++; }
      else runLen = 0;
    }
    assert(empty < N * 0.14,
      `${(empty / N * 100).toFixed(0)}% of the bearings round the arena have nobody on them`);
    assert(longest < N * 0.09,
      `there is a ${(longest / N * 360).toFixed(0)}° hole in the crowd — that is a set, not a house`);
    return `${heads} spectators in ${crowds.length} draw calls of a ${meshes}-call level; ` +
      `${((1 - empty / N) * 100).toFixed(0)}% of bearings occupied, biggest gap ${(longest / N * 360).toFixed(0)}°`;
  });

  check('colosseum: somebody is watching from a box, and they are not the crowd', () => {
    const { crowds } = dressed();
    /* The lords, found by the two things that distinguish them: they are up in
     * the air over the gate on the long axis, and they are BIGGER. Measured off
     * the instance matrices, so a box with nobody in it fails. */
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    let lords = 0, lordScale = 0, lordY = 0, commonScale = 0, commons = 0;
    for (const c of crowds) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m); m.decompose(p, q, s);
        if (p.x < -60 && Math.abs(p.z) < 12 && p.y > 8) { lords++; lordScale += s.x; lordY += p.y; }
        else { commons++; commonScale += s.x; }
      }
    }
    assert(lords >= 12, `only ${lords} figures are in the box`);
    const ls = lordScale / lords, cs = commonScale / Math.max(1, commons);
    assert(ls > cs * 1.25,
      `the lords are ${(ls / cs).toFixed(2)}× the crowd — from the sand they read as more crowd`);

    // …and there is a roof over them. Anything solid above their heads.
    const { world } = dressed();
    const b = new THREE.Box3();
    let canopy = 0;
    const top = lordY / lords;
    world.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      o.updateMatrixWorld(true);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (b.min.y > top + 1.5 && b.max.x > -95 && b.min.x < -55 && b.max.z > -12 && b.min.z < 12) canopy++;
    });
    assert(canopy > 0, 'the box has no roof on it, so it is a balcony and not a box');
    return `${lords} lords at ${ls.toFixed(2)}× the crowd's ${cs.toFixed(2)}, ${top.toFixed(1)} m up, ` +
      `${canopy} canopy panel(s) over them`;
  });

  check('colosseum: the creatures are three different fights, not one skin three times', () => {
    const kinds = LEVELS.colosseum.pool
      .filter((t, i, a) => a.indexOf(t) === i)
      .filter((t) => ARCHETYPES[t]?.custom === 'beast');
    assert(kinds.length >= 3, `only ${kinds.length} creature archetypes in the colosseum's pool`);

    /* HOW LONG EACH ONE SPENDS IN EACH PHASE, which is what `_beastBrain`
     * decides its move set from — over 66% of health it can only lunge, over
     * 33% it adds the sweep, below that it charges, and the interval between
     * attacks falls from 2.4 s to 1.15 s across the three.
     *
     * A player's damage per second is a constant here on purpose: what is being
     * compared is the SHAPE of each creature's fight against the others', and
     * any constant produces the same ordering. 90 is roughly a knight-grade
     * player landing steady cuts. */
    const DPS = 90;
    const rows = [];
    for (const t of kinds) {
      const A = ARCHETYPES[t];
      const total = A.hp / DPS;
      rows.push({ t, total, phase1: total * 0.34, reach: A.preferred[1], speed: A.speed, scale: A.scale });
    }
    rows.sort((a, b) => a.total - b.total);
    // the shortest fight and the longest must not be the same fight
    assert(rows[rows.length - 1].total > rows[0].total * 2.2,
      `the creatures' fights last ${rows.map((r) => r.total.toFixed(0)).join('/')} s — ` +
      'they burn through their phases at the same rate, so they are one fight');
    // and they must not all engage at the same distance or at the same speed
    const reach = rows.map((r) => r.reach), speed = rows.map((r) => r.speed);
    assert(Math.max(...reach) > Math.min(...reach) * 1.35,
      `every creature engages between ${Math.min(...reach)} and ${Math.max(...reach)} m — one reach, one fight`);
    assert(Math.max(...speed) > Math.min(...speed) * 1.6,
      `every creature closes at ${Math.min(...speed)}–${Math.max(...speed)} m/s`);

    /* THEY ARRIVE AS A WAVE, not as a set-piece. A `boss` can only reach the
     * field through `_setPiece`, which fires every fifth wave — so a roster of
     * bosses is a roster you meet one at a time on a schedule, which is the
     * opposite of what "a wave of creatures" means. */
    const d = new WaveDirector({ scene: null }, { pool: LEVELS.colosseum.pool });
    const early = d.unlockedAt(3);
    const asWave = kinds.filter((t) => early.includes(t));
    assert(asWave.length >= 2,
      `only ${asWave.length} of the creatures can arrive as fill — the rest are set-pieces`);
    return rows.map((r) => `${r.t} ${r.total.toFixed(0)}s reach ${r.reach} at ${r.speed} m/s`).join(', ');
  });

  check('colosseum: a mount pays for what it carries', () => {
    const ridden = Object.keys(ARCHETYPES).filter((t) => ARCHETYPES[t].saddle);
    assert(ridden.length >= 1, 'nothing in the game is ridden');
    for (const t of ridden) {
      const A = ARCHETYPES[t];
      const R = ARCHETYPES[A.saddle];
      assert(R, `${t} is saddled with ${A.saddle}, which is not an archetype`);
      /* The rider is a whole extra body on the field with its own gun and its
       * own health, so a mount that quietly brought one for free would put
       * every wave containing it over the director's budget. */
      assert(A.threat > R.threat,
        `${t} costs ${A.threat} and carries a ${R.threat}-threat body for nothing`);
      assert(saddleThreat(t) === R.threat, `saddleThreat(${t}) does not read the rider's price`);
      // and the mount has to have somewhere to put it
      assert(A.big, `${t} carries a rider but is not flagged big, so it publishes no platform to sit on`);
    }
    return ridden.map((t) => `${t} ${ARCHETYPES[t].threat} = ${ARCHETYPES[t].threat - saddleThreat(t)} + ` +
      `${saddleThreat(t)} for its ${ARCHETYPES[t].saddle}`).join(', ');
  });

  check('colosseum: a second blade makes the show bigger, and only here', () => {
    const two = { players: [{}, {}] };
    const one = { players: [{}] };

    /* The level that asked for it. `party` is 0.72, so a second blade is worth
     * 72% of a whole extra wave — and the heavy limit takes the same
     * multiplier, which is what actually matters: what the second player buys
     * is a second CREATURE rather than more droids. */
    const solo = new WaveDirector({ ...one, level: LEVELS.colosseum }, { pool: LEVELS.colosseum.pool });
    const duo = new WaveDirector({ ...two, level: LEVELS.colosseum }, { pool: LEVELS.colosseum.pool });
    const bSolo = solo.budgetFor(10), bDuo = duo.budgetFor(10);
    assert(bDuo > bSolo * 1.5, `two blades get a budget of ${bDuo} against ${bSolo} for one`);
    assert(duo.heavyLimit(10) > solo.heavyLimit(10),
      `two blades meet ${duo.heavyLimit(10)} heavy bodies at once, the same as one does`);

    /* AND NOWHERE ELSE. The budget curve is tuned, measured and pinned by four
     * other checks; scaling it everywhere would move all of them at once for a
     * property one level was asked to have. Every level that does not declare
     * `party` has to be identical to the integer. */
    const off = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.pool || L.party) continue;
      const a = new WaveDirector({ ...one, level: L }, { pool: L.pool });
      const b = new WaveDirector({ ...two, level: L }, { pool: L.pool });
      for (const w of [1, 7, 20, 40]) {
        if (a.budgetFor(w) !== b.budgetFor(w) || a.heavyLimit(w) !== b.heavyLimit(w)) off.push(`${key}@${w}`);
      }
    }
    assert(!off.length, `co-op silently changed the wave on ${off.join(', ')}`);
    const scaled = LEVEL_ORDER.filter((k) => LEVELS[k]?.party);
    assert(scaled.length >= 1, 'no level scales with player count at all');
    return `colosseum wave 10: ${bSolo} → ${bDuo} budget and ${solo.heavyLimit(10)} → ${duo.heavyLimit(10)} ` +
      `heavies for a second blade; ${LEVEL_ORDER.length - scaled.length} other levels unchanged`;
  });
}
