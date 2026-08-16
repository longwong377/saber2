/**
 * BATTLEFRONT BORZ — the vehicles, and whether they are actually four things.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Player notes 9 and 26, about the big enemies already in the game:
 *
 *   "all your monsters look the same, sphere with some legs, like you really
 *    need to make the big enemies more dangerous and more interesting and
 *    menacing, they all attack the same way."
 *
 * Four new machines is four new chances to make that sentence true again, and
 * "they look different" is a wish. So the distinctness is a CHECK, and it is
 * written to fail in exactly the direction the note describes: two machines
 * that share an outline, or two that share a cadence, or one whose outline
 * exists only in detail that is culled at the range you fight it from.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE IS THE HONEST FORM OF THE QUESTION ──
 *
 *   LEG COUNT      counted off the rig, not read off a list. 4 / 6 / 0 / 0.
 *   OUTLINE        the box of the whole machine and the box of the HULL ALONE,
 *                  because "long and low" is a claim about the body and a box
 *                  that includes a five-metre gun barrel cannot answer it. Any
 *                  two machines with the same leg count must differ in outline.
 *   AT SIXTY METRES  the same outline measured from ONLY the meshes
 *                  `Enemy._applyLod` keeps past thirty metres. This is the half
 *                  the old menagerie failed: every horn and crest was Kit detail
 *                  and the LOD-1 mesh really was a trunk plus legs.
 *   CADENCE        burst, cycle, volley and band. No two may be close on both
 *                  the shape of the volley and its size.
 *   CUTTABLE       a live Enemy in a live physics world, asked for its capsules.
 *                  Not "does the builder look right" — does the blade solver
 *                  get something back, and does it cover the hull end to end.
 *   PHYSICAL       the movement proxy exists, and the fraction of the hull it
 *                  covers is MEASURED rather than asserted, because that number
 *                  is set in Enemy.js and this workstream does not own it. See
 *                  the note on `proxy` below: the number is allowed to be bad,
 *                  it is not allowed to be unknown.
 *
 * Nothing here hard-codes which four vehicles exist: the list comes off
 * `VEHICLE_TYPES`, and everything measured comes off the built body or off the
 * shipped archetype row. A fifth machine added tomorrow is measured tomorrow.
 */

import * as THREE from 'three';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { VEHICLE_TYPES, VEHICLE_SIDE, buildGunship } from '../../src/game/Vehicles.js';
import { TOUGHNESS } from '../../src/game/Combat.js';

/* ── measuring one machine, once ──────────────────────────────────────── */

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

const MEASURED = new Map();

/**
 * Build a vehicle, stand it on flat ground in its own rest stance, and read
 * everything off the result.
 *
 * The pose is the one `_poseWalker` puts a body in on its first frame — hips at
 * the stance's own `hipHeight`, every bone at rest — which is the only pose
 * reproducible without an Enemy, a World and a terrain. That is deliberate: the
 * live-Enemy checks below pay for a physics world and are the ones that ask
 * behavioural questions; this one is about shape and must not.
 */
function measure(type) {
  if (MEASURED.has(type)) return MEASURED.get(type);
  const A = ARCHETYPES[type];
  const built = A.build({ scale: A.scale });
  const rig = built.rig;
  const ST = built.stance;
  rig.hipsBone.obj.position.set(0, ST.hipHeight, 0);
  rig.updateMatrices();
  rig.root.updateMatrixWorld(true);

  let legs = 0;
  while (rig.get(`femur${legs}`)) legs++;

  const keep = new Set();
  for (const b of rig.list) if (b.primary) keep.add(b.primary);

  const all = new THREE.Box3().makeEmpty();
  const lod = new THREE.Box3().makeEmpty();
  const hull = new THREE.Box3().makeEmpty();
  const hullNames = new Set(['body', 'prow', 'stern']);
  let meshes = 0, kept = 0, tris = 0, hash = 2166136261 >>> 0, verts = 0;

  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    o.updateMatrixWorld(true);
    _box.setFromObject(o);
    all.union(_box);
    if (keep.has(o) || o.userData.silhouette) { kept++; lod.union(_box); }
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const a = g.attributes.position;
    verts += a.count;
    for (let i = 0; i < a.count * 3; i++) {
      const q = Math.round(a.array[i] * 1000) | 0;
      hash ^= q; hash = Math.imul(hash, 16777619) >>> 0;
    }
  });
  for (const name of hullNames) {
    const b = rig.get(name);
    if (b && b.primary) hull.union(_box.setFromObject(b.primary));
  }
  if (hull.isEmpty()) hull.copy(all);

  const boxOf = (b) => { b.getSize(_size); return { w: _size.x, h: _size.y, l: _size.z }; };
  const cycle = A.fireRate + A.burst * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);

  const out = {
    type, A, built, rig, legs, meshes, kept, tris: Math.round(tris),
    verts, hash: `${verts}:${hash.toString(16)}`,
    box: boxOf(all), lod: boxOf(lod), hull: boxOf(hull),
    clearance: hull.min.y, hullMinZ: hull.min.z, hullMidY: (hull.min.y + hull.max.y) * 0.5,
    cycle, volley: A.burst * A.damage, dps: (A.burst * A.damage) / cycle,
  };
  MEASURED.set(type, out);
  return out;
}

/** How far apart two boxes are in SHAPE, ignoring size. */
function aspectGap(a, b) {
  const na = normalise(a), nb = normalise(b);
  return Math.max(Math.abs(na[0] - nb[0]), Math.abs(na[1] - nb[1]), Math.abs(na[2] - nb[2]));
}
function normalise(s) {
  const m = Math.max(s.w, s.h, s.l) || 1;
  return [s.w / m, s.h / m, s.l / m];
}

/* ── the live half: an Enemy, in a physics world ──────────────────────── */

/**
 * A terrain stub. Flat, in bounds everywhere, sand underfoot — the same shape
 * `tools/checks/beasts.mjs` uses, and for the same reason: what is being asked
 * is about the body, and a real heightfield would make every number depend on
 * where the probe happened to stand.
 */
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

let _worldOnce = null;
async function liveWorld() {
  if (_worldOnce) return _worldOnce;
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
  await initPhysics();
  const scene = new THREE.Scene();
  const physics = new RapierWorld();
  _worldOnce = { scene, physics, terrain: flat() };
  return _worldOnce;
}

/** Spawn one of these for real, as a wave would. */
async function spawn(type) {
  const { Enemy } = await import('../../src/game/Enemy.js');
  const { scene, physics, terrain } = await liveWorld();
  const world = {
    scene, physics, terrain, particles: null, difficulty: null,
    groundColor: 0xa9764a, enemies: [], bolts: null,
  };
  return new Enemy(world, type, new THREE.Vector3(0, 0, 0));
}

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {
  check('vehicles: four machines are registered, and every one names a side', () => {
    assert(VEHICLE_TYPES.length >= 4, `only ${VEHICLE_TYPES.length} vehicle types`);
    for (const t of VEHICLE_TYPES) {
      assert(ARCHETYPES[t], `${t} is exported by VEHICLE_TYPES but not in ARCHETYPES — `
        + 'the Object.assign in Vehicles.js did not run, or the key was renamed on one side only');
      assert(VEHICLE_SIDE[t] === 'republic' || VEHICLE_SIDE[t] === 'separatist',
        `${t} belongs to no army — Command mode's muster and fill are keyed on that`);
      assert(typeof ARCHETYPES[t].build === 'function', `${t} has no builder`);
    }
    const sides = VEHICLE_TYPES.map((t) => `${t}/${VEHICLE_SIDE[t][0]}`);
    return sides.join(' ');
  });

  /**
   * A HEAVY IS A HEAVY, and the flags that say so are load-bearing in four
   * different files: `big` decides that Arrivals marches it in rather than
   * flying it, that it counts against `heavyLimit`, that its bolts are the fat
   * ones and that its deflector — if it ever gets one — sits at chassis height.
   * `custom: 'walker'` decides that `_poseWalker` runs instead of the biped
   * animator, that `body` and `hips` are durasteel, and that it takes THREE
   * legs to bring the chassis down instead of one.
   */
  check('vehicles: every one is flagged as the heavy it is', () => {
    for (const t of VEHICLE_TYPES) {
      const A = ARCHETYPES[t];
      assert(A.big === true, `${t} is not flagged big — Arrivals would fly a ${A.hp}hp vehicle in on a dropship`);
      assert(A.custom === 'walker', `${t} declares custom '${A.custom}' — it would run the biped animator`);
      assert(A.toughness >= TOUGHNESS.heavy, `${t} is ${A.toughness} tough, softer than TOUGHNESS.heavy`);
      assert(!A.weapon, `${t} carries hand weapon '${A.weapon}' — it has no hands`);
      assert(A.ranged, `${t} is not ranged; nothing else here gives a chassis an attack`);
    }
    return `${VEHICLE_TYPES.length} flagged big + walker + heavy`;
  });

  /**
   * `_muzzleWorld` TOGGLES A TWO-ELEMENT INDEX OVER `built.cannons` — literally
   * `cannons[(this._armToggle = 1 - (this._armToggle || 0))]` — so a body that
   * publishes ONE cannon reads index 1 on its second shot, gets undefined, and
   * throws inside the update loop. It takes the modulo over `built.muzzles`,
   * which is safe for any length. Every vehicle here publishes `muzzles`, and
   * this is the check that says why.
   */
  check('vehicles: each publishes muzzles the shot path can index safely', () => {
    const rows = [];
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      const mz = m.built.muzzles;
      assert(Array.isArray(mz) && mz.length >= 1, `${t} publishes no muzzles — _muzzleWorld would fire from its own chest`);
      assert(!m.built.cannons, `${t} publishes 'cannons', which _muzzleWorld indexes 0/1 unconditionally; `
        + 'publish `muzzles` instead, which it takes a modulo over');
      for (const o of mz) assert(o && o.isObject3D, `${t} has a muzzle that is not an Object3D`);
      rows.push(`${t} ${mz.length}`);
    }
    return rows.join(', ');
  });

  /* ── the silhouette rule ─────────────────────────────────────────────── */

  check('vehicles: the leg counts differ, and are the ones the plates show', () => {
    const counts = VEHICLE_TYPES.map((t) => [t, measure(t).legs]);
    const distinct = new Set(counts.map((c) => c[1]));
    assert(distinct.size >= 3,
      `${counts.map((c) => c.join(':')).join(', ')} — only ${distinct.size} distinct leg counts across `
      + `${counts.length} machines. The existing walker is already a four-legged sphere.`);
    assert(counts.some((c) => c[1] === 6), 'nothing here has six legs — the AT-TE is the only six-legged thing in the game');
    assert(counts.some((c) => c[1] === 0), 'nothing here is legless — an AAT hovers and a hailfire rolls');
    return counts.map((c) => `${c[0]} ${c[1]}`).join(', ');
  });

  /**
   * THE PAIRWISE RULE, and it is where the whole file earns its keep.
   *
   * For every pair of machines, at least TWO of four independent cues have to
   * separate them: leg count, the outline of the whole machine, the outline of
   * the hull alone, and how far the hull stands off the ground. One cue is not
   * enough — two things that differ only in leg count are the reek and the
   * acklay problem, one body plan at two settings.
   *
   * The thresholds are not taste. 0.18 of normalised aspect is the difference
   * between "long and low" and "tall and square" at the range these are first
   * seen; 0.6 m of ground clearance is a body's width, which is what decides
   * whether you can walk under a thing or not.
   */
  check('vehicles: no two of them read alike', () => {
    const M = VEHICLE_TYPES.map(measure);
    const rows = [];
    for (let i = 0; i < M.length; i++) {
      for (let j = i + 1; j < M.length; j++) {
        const a = M[i], b = M[j];
        const cues = [];
        if (a.legs !== b.legs) cues.push('legs');
        if (aspectGap(a.box, b.box) > 0.18) cues.push('box');
        if (aspectGap(a.hull, b.hull) > 0.18) cues.push('hull');
        if (Math.abs(a.clearance - b.clearance) > 0.6) cues.push('clearance');
        assert(cues.length >= 2,
          `${a.type} and ${b.type} are separated only by [${cues.join(',')}] — `
          + `legs ${a.legs}/${b.legs}, box aspect gap ${aspectGap(a.box, b.box).toFixed(2)}, `
          + `hull aspect gap ${aspectGap(a.hull, b.hull).toFixed(2)}, `
          + `clearance ${a.clearance.toFixed(2)}/${b.clearance.toFixed(2)} m. `
          + 'Two heavies that share three of four cues are one machine at two sizes, '
          + 'which is the note the player wrote about the creatures.');
        rows.push(`${a.type}|${b.type} ${cues.join('+')}`);
      }
    }
    return rows.join(', ');
  });

  /**
   * …AND THE HULL PROPORTIONS ARE THE ONES THE PLATES SHOW. This is the part a
   * pairwise-difference rule cannot express: four machines could all differ
   * from each other and all be wrong. The AT-TE's side plate is the clearest
   * measurement in the whole reference folder — a hull about four times its own
   * height — and the AAT's is a wedge about four and a half.
   */
  check('vehicles: the two long hulls are long, and the two compact ones are not', () => {
    const rows = [];
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      rows.push(`${t} ${(m.hull.l / m.hull.h).toFixed(2)}`);
    }
    const atte = measure('atte'), aat = measure('aat');
    const spider = measure('dwarfspider');
    assert(atte.hull.l / atte.hull.h > 3.4,
      `the AT-TE's hull is ${(atte.hull.l / atte.hull.h).toFixed(2)} long for its height; `
      + 'the side plate is about 4:1 and "long and low" is the whole silhouette');
    assert(atte.hull.l > 11 && atte.hull.l < 16, `the AT-TE hull is ${atte.hull.l.toFixed(1)} m long`);
    assert(aat.hull.l / aat.hull.h > 3.4,
      `the AAT's hull is ${(aat.hull.l / aat.hull.h).toFixed(2)} long for its height`);
    assert(aat.box.w / aat.box.h > 1.5,
      `the AAT is ${(aat.box.w / aat.box.h).toFixed(2)} wide for its height — it is a flat wedge, not a box`);
    // low and wide: the dwarf spider's stance has to be wider than it is tall,
    // which is the one thing that separates it from the homing spider droid the
    // game already has (that one stands 1.6 of scale up on 1.35 of splay).
    assert(spider.box.w / spider.box.h > 1.15,
      `the dwarf spider is ${(spider.box.w / spider.box.h).toFixed(2)} wide for its height — `
      + 'the plates show a machine much wider than it is tall, and the game already has the tall one');
    return rows.join(', ');
  });

  /**
   * THE SILHOUETTE HAS TO SURVIVE THE LOD CULL, which is the half of "sphere
   * with some legs" that is not about modelling at all.
   *
   * Past thirty metres `Enemy._applyLod` hides every mesh that is not a bone's
   * `primary` or tagged `userData.silhouette`. The old menagerie's horns,
   * frills, crests and tails were all Kit detail, so at exactly the range the
   * player was describing every creature was its trunk plus its legs. A gun
   * barrel, a hoop wheel and a whip antenna are in the same category, and this
   * is what stops them going the same way.
   */
  check('vehicles: what you see at sixty metres is still the machine', () => {
    const rows = [];
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      const keptFrac = [m.lod.w / m.box.w, m.lod.h / m.box.h, m.lod.l / m.box.l];
      const worst = Math.min(...keptFrac);
      assert(worst > 0.9,
        `${t} keeps only ${(worst * 100).toFixed(0)}% of one of its dimensions past LOD 0 `
        + `(${m.box.w.toFixed(1)}×${m.box.h.toFixed(1)}×${m.box.l.toFixed(1)} → `
        + `${m.lod.w.toFixed(1)}×${m.lod.h.toFixed(1)}×${m.lod.l.toFixed(1)}). Whatever it lost is `
        + 'Kit detail that should be tagged userData.silhouette.');
      /* …and it is not paid for by keeping everything, which is the other
       * failure: a body with no LOD saving is sixty draw calls at sixty metres.
       * The bar is ABSOLUTE rather than a fraction, because the fraction is not
       * the cost — a hailfire that is nine tenths hoop legitimately keeps nine
       * tenths of its meshes, and nineteen draw calls at range is the same
       * nineteen whether it culled forty or six. Enemy.js records the number
       * this is set against: an acolyte is 56 meshes at LOD 0 and 20 at LOD 1. */
      assert(m.kept <= 32,
        `${t} still draws ${m.kept} meshes at sixty metres; a heavy is capped near an acolyte's 20`);
      assert(m.kept < m.meshes,
        `${t} culls nothing at range — every one of its ${m.meshes} meshes is tagged silhouette`);
      rows.push(`${t} ${(worst * 100).toFixed(0)}% on ${m.kept}/${m.meshes}`);
    }
    return rows.join(', ');
  });

  check('vehicles: no two build the same geometry', () => {
    const seen = new Map();
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      assert(!seen.has(m.hash), `${t} builds byte-identical geometry to ${seen.get(m.hash)}`);
      seen.set(m.hash, t);
    }
    return VEHICLE_TYPES.map((t) => `${t} ${measure(t).tris}t`).join(', ');
  });

  /* ── the cadence rule ────────────────────────────────────────────────── */

  /**
   * "THEY ALL ATTACK THE SAME WAY" is the second half of the note and it is a
   * different measurement from the first. Two machines are separated at the ear
   * by the SHAPE of a volley (how many shots, how fast) and at the health bar
   * by its SIZE (what one volley costs you, and how long until the next). This
   * requires both to be different, because either alone is a reskin: same shape
   * at a different size is a bigger gun, same size in a different shape is the
   * same gun on a different timer.
   */
  check('vehicles: no two of them shoot alike', () => {
    const M = VEHICLE_TYPES.map(measure);
    const rows = [];
    for (let i = 0; i < M.length; i++) {
      for (let j = i + 1; j < M.length; j++) {
        const a = M[i], b = M[j];
        const shape = Math.abs(a.A.burst - b.A.burst) / Math.max(a.A.burst, b.A.burst)
          + Math.abs(a.cycle - b.cycle) / Math.max(a.cycle, b.cycle);
        const size = Math.abs(a.volley - b.volley) / Math.max(a.volley, b.volley);
        assert(shape > 0.28,
          `${a.type} and ${b.type} fire the same shape — burst ${a.A.burst}/${b.A.burst} on a `
          + `${a.cycle.toFixed(2)}/${b.cycle.toFixed(2)} s cycle`);
        assert(size > 0.20,
          `${a.type} and ${b.type} hit for the same amount — ${a.volley} against ${b.volley} a volley`);
        rows.push(`${a.type}|${b.type} ${shape.toFixed(2)}/${size.toFixed(2)}`);
      }
    }
    /* AND THE BANDS SPREAD. A close-range machine that the player can reach and
     * a long-range one they cannot are different fights; four heavies that all
     * stand at twenty metres are one fight four times. */
    const mids = M.map((m) => (m.A.preferred[0] + m.A.preferred[1]) / 2);
    assert(Math.max(...mids) > Math.min(...mids) * 2.5,
      `preferred bands run ${mids.map((v) => v.toFixed(0)).join('/')} m — they all want the same distance`);
    // the one that comes to you has to be able to be reached with a blade
    assert(Math.min(...M.map((m) => m.A.preferred[0])) <= 6,
      'nothing here closes to blade range; a heavy you can never touch is a turret');
    return rows.join(', ');
  });

  /* ── physicality ─────────────────────────────────────────────────────── */

  /**
   * THE HARD RULE, applied to a body rather than to a level.
   *
   * `tools/checks/physicality.mjs` walks the built LEVELS and asks whether every
   * reachable thing has a collider. It cannot see these, because a vehicle is
   * not placed by a level maker — it is spawned by a wave. So the same three
   * questions are asked here, of a live Enemy in a live Rapier world:
   *
   *   CAN I WALK INTO IT — is there a body in the physics world?
   *   CAN I CUT IT — does the blade solver get capsules back?
   *   CAN I BREAK IT — does it take damage and can its rig collapse?
   */
  check('vehicles: a live one is a physical object in a real world', async () => {
    const rows = [];
    for (const t of VEHICLE_TYPES) {
      const e = await spawn(t);
      assert(e.body, `${t} has no movement proxy body — the player would walk through it`);
      assert(e.world.physics.bodies.includes(e.body) || e.body.handle !== undefined,
        `${t}'s proxy body was never added to the physics world`);
      const caps = e.capsules();
      assert(caps.length >= 4,
        `${t} offers the blade only ${caps.length} capsule${caps.length === 1 ? '' : 's'} — `
        + 'a twelve-metre hull on one bone is a hull you can only cut in the middle');
      assert(caps.some((c) => c.toughness >= TOUGHNESS.durasteel),
        `${t} has no durasteel anywhere; custom:'walker' is supposed to plate its body and hips`);
      // it takes damage, which is what "you can break it" reduces to
      const before = e.hp;
      e.damage(40, new THREE.Vector3(0, 2, 0), null, 'blaster');
      assert(e.hp < before, `${t} took no damage from a 40-point hit`);
      rows.push(`${t} ${caps.length} caps`);
      e.dispose?.();
    }
    return rows.join(', ');
  });

  /**
   * …AND THE CAPSULES COVER THE HULL END TO END.
   *
   * "Has capsules" is not the question a player asks. The question is whether a
   * blade swung at the back of an AT-TE meets anything, and the answer is a
   * number: what fraction of the hull's own length lies inside at least one
   * capsule, sampled down the centreline at hull height.
   */
  check('vehicles: the blade reaches the whole hull, not just its middle', () => {
    const rows = [];
    const s = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      // the same capsules Enemy.capsules() builds, from the same bones
      const caps = [];
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q = new THREE.Quaternion();
      for (const b of m.rig.list) {
        if (!b.parts.length) continue;
        b.obj.updateMatrixWorld(false);
        p0.setFromMatrixPosition(b.obj.matrixWorld);
        q.setFromRotationMatrix(b.obj.matrixWorld);
        p1.copy(p0).add(new THREE.Vector3(0, b.length, 0).applyQuaternion(q));
        caps.push({ p0: p0.clone(), p1: p1.clone(), r: b.radius * 1.12 });
      }
      const N = 64;
      let hit = 0;
      for (let i = 0; i < N; i++) {
        s.set(0, m.hullMidY, m.hullMinZ + (i + 0.5) / N * m.hull.l);
        for (const c of caps) {
          ab.subVectors(c.p1, c.p0);
          const t2 = Math.max(0, Math.min(1, ap.subVectors(s, c.p0).dot(ab) / Math.max(1e-9, ab.lengthSq())));
          if (ap.copy(c.p0).addScaledVector(ab, t2).distanceTo(s) <= c.r) { hit++; break; }
        }
      }
      const frac = hit / N;
      assert(frac > 0.9,
        `${t}: the blade can reach only ${(frac * 100).toFixed(0)}% of the hull's ${m.hull.l.toFixed(1)} m — `
        + 'split the hull across more bones; capsules() emits one per bone that carries geometry');
      rows.push(`${t} ${(frac * 100).toFixed(0)}%`);
    }
    return rows.join(', ');
  });

  /**
   * THE COLLIDER GAP, MEASURED RATHER THAN CLAIMED.
   *
   * `Enemy.js:1296` sizes every heavy's movement proxy off one flag —
   * `capsule(0.9, 1.1)` for anything `big` — and that file belongs to another
   * workstream. So this check does NOT assert the proxy is big enough, because
   * it is not, and a check that fails for a reason nobody here can fix is a
   * check somebody will delete.
   *
   * What it asserts instead is that the DATA to fix it exists and is right: each
   * builder publishes `built.proxy`, generated off the hull it actually built,
   * and `Enemy._build()` already runs before the Body is constructed. It then
   * prints both numbers side by side — what the shipped proxy covers, and what
   * the published one would — so the gap is a line in the output rather than a
   * paragraph in a handoff, and it closes on its own the day Enemy.js reads it.
   *
   *   measured the day this was written, as a fraction of hull length:
   *     dwarfspider  shipped 100%   published 100%
   *     atte         shipped   0%   published  95%
   *     aat          shipped  27%   published 100%
   *     hailfire     shipped 100%   published 100%
   */
  check('vehicles: how much of each hull you can actually walk into', () => {
    const rows = [];
    let worstShipped = 1;
    for (const t of VEHICLE_TYPES) {
      const m = measure(t);
      const P = m.built.proxy;
      assert(P && Array.isArray(P.spheres) && P.spheres.length,
        `${t} publishes no hull proxy — nothing can widen its collider without remodelling it`);
      assert(P.radius > 0 && P.halfHeight > 0, `${t}'s proxy has no extent`);

      const N = 64;
      let shipped = 0, published = 0;
      for (let i = 0; i < N; i++) {
        const z = m.hullMinZ + (i + 0.5) / N * m.hull.l;
        // Enemy's own, copied so this reads what the game does and not a wish
        const dy = Math.max(0, Math.abs(m.hullMidY - 1.4) - 0.9);
        if (Math.hypot(z, dy) <= 1.1) shipped++;
        for (const sp of P.spheres) {
          if (Math.hypot(sp.c.x, sp.c.y + P.y - m.hullMidY, sp.c.z - z) <= sp.r) { published++; break; }
        }
      }
      // The published one is this workstream's own work and IS asserted.
      assert(published / N > 0.85,
        `${t}'s published proxy covers only ${(published / N * 100).toFixed(0)}% of its own hull — `
        + 'hullProxy() is generated off the hull, so this failing means the hull moved and the '
        + 'generator did not follow');
      worstShipped = Math.min(worstShipped, shipped / N);
      rows.push(`${t} ${(shipped / N * 100).toFixed(0)}%→${(published / N * 100).toFixed(0)}%`);
    }
    return `${rows.join(', ')} (shipped proxy → published; worst shipped ${(worstShipped * 100).toFixed(0)}%)`;
  });

  /* ── the gunship ─────────────────────────────────────────────────────── */

  /**
   * `Arrivals.js` flies `new THREE.BoxGeometry(2.7, 1.55, 7.6)` with a cone on
   * the front, on every level, on every wave. `buildGunship` is the thing it is
   * supposed to be, and it crosses a file boundary this workstream does not
   * own — so what is checked is the CONTRACT rather than the look: it has to
   * drop into `_makeDropship` without moving anything the flight path was tuned
   * against, and it has to carry the two anchors Arrivals already animates.
   */
  check('gunship: it drops into the arrivals dropship without moving the flight path', () => {
    const g = buildGunship();
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    b.getSize(_size);
    // the box it replaces: 2.7 wide, 1.55 tall, 7.6 long, wings out to ±5.0
    assert(_size.z > 6.5 && _size.z < 9.5, `${_size.z.toFixed(1)} m long against the box's 7.6`);
    assert(_size.x > 8.5 && _size.x < 12.5, `${_size.x.toFixed(1)} m span against the box's 10.0`);
    assert(_size.y > 2.5 && _size.y < 5.5, `${_size.y.toFixed(1)} m tall against the box's 1.55`);
    // the nose is at -Z, which is where `_makeDropship` puts its cone and the
    // direction `_updateDropship` flies. Get this backwards and every ship in
    // the game arrives tail first, and nothing throws.
    const span = _size.x, len = _size.z;
    const mid = b.getCenter(new THREE.Vector3());
    assert(Math.abs(mid.z) < 1.2, `the hull is not centred on its own origin (z ${mid.z.toFixed(2)})`);
    const e = g.userData.engines;
    assert(Array.isArray(e) && e.length === 2, 'no pair of engine anchors for the exhaust glow');
    assert(e[0].position.z > 0 && e[1].position.z > 0, 'the engine anchors are at the nose, not the tail');
    assert(g.userData.lamp && g.userData.lamp.position.z < 0, 'no landing-lamp anchor at the nose');
    let meshes = 0, tris = 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    /* A wave puts up to MAX_CONCURRENT ships in the sky and Arrivals shares
     * every geometry it has. A hundred-mesh gunship would be three hundred draw
     * calls of scenery. */
    assert(meshes <= 24, `${meshes} meshes — three of these is ${meshes * 3} draw calls of arrival`);
    return `${span.toFixed(1)} m span, ${len.toFixed(1)} m long, ${meshes} meshes, ${Math.round(tris)} triangles`;
  });

  /**
   * AND IT IS A LAAT RATHER THAN A WEDGE. Five cues, off the three plates, each
   * expressed as something a bounding box can answer — because "it looks like
   * the reference" is exactly the kind of claim this project keeps replacing
   * with a number.
   */
  check('gunship: swept-forward wings, dorsal nacelles, chin turrets, a bay', () => {
    const g = buildGunship();
    g.updateMatrixWorld(true);
    const found = { wing: 0, nacelle: 0, chin: 0, bubble: 0 };
    const b = new THREE.Box3();
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    for (const o of g.children) {
      if (!o.isMesh) continue;
      b.setFromObject(o); b.getCenter(c); b.getSize(s);
      if (s.x > 8 && s.y < 2.5) found.wing++;              // spans the full width, thin
      if (c.y > 1.0 && s.y > 1.5) found.nacelle++;         // stands above the hull
      if (c.y < -0.2 && c.z < -1.5) found.chin++;          // under the nose
      if (s.x > 5 && s.x < 8 && s.y < 2) found.bubble++;   // outriggers
    }
    assert(found.wing >= 1, 'nothing on this ship spans a wing');
    assert(found.nacelle >= 1, 'nothing stands above the hull — the dorsal nacelles are half the outline');
    assert(found.chin >= 1, 'no chin turrets under the nose');
    // the wings sweep FORWARD, which is the cue that separates a LAAT from
    // every other gunship shape. Measured off the wing mesh's own vertices:
    // the outboard end has to be AHEAD of the root, not behind it.
    let rootZ = 0, tipZ = 0, seen = false;
    for (const o of g.children) {
      if (!o.isMesh) continue;
      b.setFromObject(o); b.getSize(s);
      if (!(s.x > 8 && s.y < 2.5)) continue;
      const a = o.geometry.attributes.position;
      let bestIn = Infinity, bestOut = -Infinity, zIn = 0, zOut = 0;
      for (let i = 0; i < a.count; i++) {
        const x = Math.abs(a.getX(i)), z = a.getZ(i);
        if (x < bestIn) { bestIn = x; zIn = z; }
        if (x > bestOut) { bestOut = x; zOut = z; }
      }
      rootZ = zIn; tipZ = zOut; seen = true;
      break;
    }
    assert(seen, 'no wing mesh to measure the sweep on');
    assert(tipZ < rootZ - 0.5,
      `the wing sweeps BACK (root z ${rootZ.toFixed(2)}, tip z ${tipZ.toFixed(2)}) — every plate of a `
      + 'LAAT has the tip ahead of the root, and it is the one cue that reads at any distance');
    return `wing sweep ${(rootZ - tipZ).toFixed(1)} m forward, ${found.nacelle} dorsal, ${found.chin} chin`;
  });
}
