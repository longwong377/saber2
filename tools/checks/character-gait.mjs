/**
 * The crab, and the cone. — src/game/Rig.js + src/game/Bodies.js
 *
 * Five playtests in a row called the walk "janky as fuck… like a crab" and the
 * figure "cone like". Neither is a matter of taste; both were single numbers,
 * and the same number turned out to be behind most of each:
 *
 *   · the knees stood 34.7cm apart on a 19.0cm pelvis, with the femur splayed
 *     9.1° OUT of vertical where a real one leans about 6° in — because the IK
 *     knee pole was planted 10cm outboard of a foot that was already 11.5cm
 *     out. Bow-legged, and the widest part of the whole silhouette from ankle
 *     to hip: wider than the robe hem, wider than the shoulders. So the figure
 *     read as a cone standing on an A-frame AND scuttled;
 *   · the track was 23.0cm at a walk. A human walks on 8-13cm;
 *   · each foot's lateral offset over a whole cycle travelled EXACTLY 0.0cm at
 *     every speed — two feet on two parallel rails, never converging, never
 *     approaching the midline, which is what a sideways gait looks like;
 *   · the drawn boot's contact patch slid 17.4mm per frame at a run — 1.04 m/s,
 *     23% of body speed — right through mid-stance with the sole flat and the
 *     full weight on it. The solver's own slide number was 0.00mm for every one
 *     of those frames, because it measures a contact point that is copied
 *     verbatim and cannot move by construction. The skating was in the geometry
 *     hung off it, so only the mesh could see it;
 *   · the boot sat with the ankle 14.5mm behind a 214mm sole — the figure had
 *     no heel at all — and where the sole met the floor was decided by the
 *     boot's thickness rather than by the animator: from -6.9mm (a trooper's
 *     sole buried in the floor) to +19.4mm (a B1 standing two centimetres off
 *     the ground);
 *   · the front-view outline from hem to belt sat 8.1mm rms from a straight
 *     line. A cone is not a texture problem, it is that number.
 *
 * Everything here is measured off the built figure and the drawn mesh, never
 * off the solver's own bookkeeping — that was exactly what hid the skating.
 */

import { Rig, humanoidSkeleton, BipedAnimator } from '../../src/game/Rig.js';
import { attachCloak } from '../../src/game/Cloth.js';
import * as B from '../../src/game/Bodies.js';

let THREE = null;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const D = 180 / Math.PI;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const range = (a) => Math.max(...a) - Math.min(...a);

const BUILD = {
  jedi: (o) => B.buildJedi(o), b1: (o) => B.buildB1(o), b2: (o) => B.buildB2(o),
  trooper: (o) => B.buildTrooper(o), acolyte: (o) => B.buildAcolyte(o),
};

/** World positions of every vertex drawn on one bone, subsampled. */
function bonePts(rig, bone, stride = 1) {
  const b = rig.get(bone);
  if (!b) return [];
  const out = [];
  for (const m of b.parts) {
    m.updateMatrixWorld(true);
    const p = m.geometry.attributes.position;
    for (let v = 0; v < p.count; v += stride) {
      out.push(V3(p.getX(v), p.getY(v), p.getZ(v)).applyMatrix4(m.matrixWorld));
    }
  }
  return out;
}

/** A figure walked in a straight line, sampled in its own body frame. */
function march(opts = {}) {
  const { speed = 0, seconds = 9, dt = 1 / 60, build = null, boots = false, opts: bopts = {} } = opts;
  const built = build ? BUILD[build](bopts) : null;
  const rig = built ? built.rig : new Rig(humanoidSkeleton(1));
  const s = rig.scale;
  const anim = new BipedAnimator(rig, { scale: s, hipHeight: 0.95 * s });
  const pos = V3(0, 0, 0);
  anim.setFacing(0);
  const rec = [];
  let prevBoot = [null, null], prevGround = [true, true];
  let bootSlip = 0, bootSlipSum = 0, bootSlipN = 0, bootLow = Infinity;
  const N = Math.round(seconds / dt);
  for (let i = 0; i < N; i++) {
    pos.z += speed * dt;
    anim.update(dt, {
      position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0,
    });
    anim.swingArms(dt, speed, 1);
    rig.updateMatrices();

    if (boots) {
      // THE HONEST SKATING NUMBER: the horizontal speed of the part of the
      // boot that is actually touching the floor. A rolling foot is allowed to
      // move most of its mesh — heel-off is real — but whatever is in contact
      // must be still, and only the drawn geometry can answer that.
      for (const k of [0, 1]) {
        const pts = bonePts(rig, k === 0 ? 'footL' : 'footR', 3);
        if (prevBoot[k] && anim.feet[k].grounded && prevGround[k] && i * dt > 2.5) {
          for (const p of pts) bootLow = Math.min(bootLow, p.y);
          for (let j = 0; j < pts.length; j++) {
            /* IN CONTACT MEANS AT THE FLOOR, and it used to mean "within 15 mm
             * of whatever the lowest part of this boot happens to be" — which
             * is not the same question and was answering it about a boot that
             * was 22 mm UNDER the floor (see the walking clause below). Two
             * ways that hid: a buried boot's lowest 15 mm is a band that never
             * touches anything, and once the boot sits ON the floor the same
             * 15 mm reaches up the curve of the toe onto geometry that is
             * genuinely rolling and is supposed to move. Measured on the jedi
             * at 4.6 m/s, the same frames: the relative window reads 4.11 mm
             * and names a vertex 14.8 mm off the ground, the floor window
             * reads 0.59 mm. The floor is not a matter of degree. */
            if (pts[j].y > 0.004 * s) continue;               // not in contact
            const d = Math.hypot(pts[j].x - prevBoot[k][j].x, pts[j].z - prevBoot[k][j].z);
            bootSlip = Math.max(bootSlip, d);
            bootSlipSum += d; bootSlipN++;
          }
        }
        prevBoot[k] = pts; prevGround[k] = anim.feet[k].grounded;
      }
    }

    if (i * dt < 2.5) continue;
    rec.push({
      // body frame: x is left-positive, z forward, both relative to the body
      fx: [anim.feet[0].pos.x - pos.x, anim.feet[1].pos.x - pos.x],
      grounded: [anim.feet[0].grounded, anim.feet[1].grounded],
      kneeX: [rig.tipPos('thighL', V3()).x, rig.tipPos('thighR', V3()).x],
      hipX: [rig.worldPos('thighL', V3()).x, rig.worldPos('thighR', V3()).x],
      hipLat: rig.worldPos('hips', V3()).x - pos.x,
    });
  }
  return {
    rig, anim, rec, scale: s,
    bootSlip, bootSlipMean: bootSlipSum / Math.max(bootSlipN, 1), bootLow,
    // track width: the lateral gap between successive PLANTS
    track: (() => {
      const p = [[], []];
      for (let i = 1; i < rec.length; i++) for (const k of [0, 1]) {
        if (rec[i].grounded[k] && !rec[i - 1].grounded[k]) p[k].push(rec[i].fx[k]);
      }
      return p[0].length && p[1].length ? mean(p[0]) - mean(p[1]) : range(rec.map(r => r.fx[0] - r.fx[1]));
    })(),
    kneeSep: mean(rec.map(r => r.kneeX[0] - r.kneeX[1])),
    hipSep: mean(rec.map(r => r.hipX[0] - r.hipX[1])),
    // how far each foot's lateral offset travels over the cycle
    latTravel: [0, 1].map(k => range(rec.map(r => r.fx[k]))),
    nearestMidline: Math.min(...rec.flatMap(r => [Math.abs(r.fx[0]), Math.abs(r.fx[1])])),
  };
}

/** A built archetype, stood up the way the game stands it. */
function standing(name) {
  const built = BUILD[name]({});
  const rig = built.rig;
  const anim = new BipedAnimator(rig, { scale: rig.scale, hipHeight: 0.95 * rig.scale });
  anim.setFacing(0);
  const pos = V3(0, 0, 0);
  for (let i = 0; i < 150; i++) {
    anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(), grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 0 });
  }
  anim.swingArms(1 / 60, 0, 1);
  rig.updateMatrices();
  rig.root.updateMatrixWorld(true);
  return { built, rig, anim };
}

/** Every drawn triangle of a rig, in world space, tagged with its bone. */
function worldTris(rig, skip = new Set()) {
  const tris = [];
  const seen = new Set();
  rig.root.updateMatrixWorld(true);
  const boneOf = (o) => { let a = o; while (a) { if (a.userData.bone) return a.userData.bone.name; a = a.parent; } return '?'; };
  rig.root.traverse((o) => {
    if (!o.isMesh || seen.has(o) || !o.geometry?.attributes?.position) return;
    seen.add(o);
    const bn = boneOf(o);
    if (skip.has(bn)) return;
    o.updateMatrixWorld(true);
    const p = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : p.count;
    const a = V3(), b = V3(), c = V3();
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
      tris.push([a.clone(), b.clone(), c.clone(), bn]);
    }
  });
  return tris;
}

/**
 * Front-view half-width of the outline at height y, by exact plane/edge
 * intersection. Sampling vertices instead reads the lathe's rings and misses
 * everything between them, which makes a smooth cone look like a staircase.
 */
function outlineAt(tris, y) {
  let w = 0, owner = '-', hit = 0;
  for (const [a, b, c, bn] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if ((p.y - y) * (q.y - y) > 0) continue;
      const den = q.y - p.y;
      if (Math.abs(den) < 1e-12) continue;
      const t = (y - p.y) / den;
      if (t < 0 || t > 1) continue;
      hit++;
      const x = Math.abs(p.x + (q.x - p.x) * t);
      if (x > w) { w = x; owner = bn; }
    }
  }
  return { w, owner, hit };
}

export function run({ check, assert, near, THREE: T }) {
  THREE = T;

  /* ── (a) the crab ──────────────────────────────────────────────────── */

  check('crab: the knees are inside the hips, not splayed outside them', () => {
    // A femur adducts. Measured before: knees 34.7cm apart on a 19.0cm pelvis
    // and the femur 9.13° OUT of vertical, because the IK pole was planted
    // 10cm outboard of a foot already 11.5cm out. Bow-legged at every speed.
    const rows = [];
    for (const speed of [0, 1.6, 4.6]) {
      const r = march({ speed });
      const splay = Math.atan2((r.kneeSep - r.hipSep) / 2, 0.44 * r.scale) * D;
      assert(r.kneeSep < r.hipSep + 0.01,
        `at ${speed} m/s the knees are ${(r.kneeSep * 100).toFixed(1)}cm apart on a `
        + `${(r.hipSep * 100).toFixed(1)}cm pelvis — the legs splay outward`);
      assert(r.kneeSep > 0.07 * r.scale,
        `at ${speed} m/s the knees are only ${(r.kneeSep * 100).toFixed(1)}cm apart — they are drawn through each other`);
      assert(splay < 1.0,
        `at ${speed} m/s the femur leans ${splay.toFixed(2)}° outward; a real one leans inward`);
      rows.push(`${speed}m/s knees ${(r.kneeSep * 100).toFixed(1)}cm, femur ${splay.toFixed(1)}°`);
    }
    return `${rows.join(', ')} — pelvis 19.0cm`;
  });

  check('crab: the track is a human one, and a walk is narrower than a stand', () => {
    // A human walks with 8-13cm between the feet and stands rather wider.
    // This was one number, 0.115, at every speed: a 23.0cm track at a walk,
    // double the top of the human band.
    const stand = march({ speed: 0 });
    const standTrack = Math.abs(stand.rec[0].fx[0] - stand.rec[0].fx[1]);
    const rows = [`stand ${(standTrack * 100).toFixed(1)}cm`];
    let last = standTrack;
    for (const speed of [1.0, 1.6, 2.5, 4.6, 7.45]) {
      const r = march({ speed });
      assert(r.track > 0.075 && r.track < 0.145,
        `at ${speed} m/s the track is ${(r.track * 100).toFixed(1)}cm — a human walks on 8-13cm`);
      assert(r.track < last + 0.006,
        `the track WIDENS from ${(last * 100).toFixed(1)}cm to ${(r.track * 100).toFixed(1)}cm by ${speed} m/s`);
      last = r.track;
      rows.push(`${speed}m/s ${(r.track * 100).toFixed(1)}cm`);
    }
    assert(standTrack > 0.15, `a standing figure's feet are only ${(standTrack * 100).toFixed(1)}cm apart`);
    return rows.join(' → ');
  });

  check('crab: the feet converge over the cycle instead of running on two rails', () => {
    // `from` and `to` sit the same distance off the midline, so a straight
    // lerp between them holds a foot's lateral offset exactly constant. It
    // measured 0.0cm of lateral travel per foot at EVERY speed — two parallel
    // rails, which is what a sideways scuttle looks like from behind.
    const rows = [];
    for (const speed of [1.0, 1.6, 2.5, 4.6]) {
      const r = march({ speed });
      const travel = Math.min(...r.latTravel);
      assert(travel > 0.015,
        `at ${speed} m/s each foot's lateral offset travels only ${(travel * 1000).toFixed(1)}mm over a whole cycle`);
      assert(r.nearestMidline < r.track * 0.62,
        `at ${speed} m/s the swing foot never gets closer than ${(r.nearestMidline * 100).toFixed(1)}cm `
        + `to the midline on a ${(r.track * 100).toFixed(1)}cm track — it does not pass inside the stance leg`);
      rows.push(`${speed}m/s ${(travel * 1000).toFixed(0)}mm, closest ${(r.nearestMidline * 100).toFixed(1)}cm`);
    }
    return rows.join(', ');
  });

  check('crab: the stance leg straightens, instead of walking in a permanent crouch', () => {
    // Knee angle is brutally non-linear in leg extension. The pelvis was held
    // at 94% of reach, which is 34.0° of flexion, and the figure carried all
    // 34 of them through mid-stance at every speed — a Groucho walk, and a
    // bent-legged one is exactly what a crab is. It also has a hard ceiling:
    // a human stance knee is ~5° off straight, which needs 99.5% of reach,
    // and solveIK clamps at 98.5%.
    const rows = [];
    for (const [speed, cap] of [[1.6, 29], [3.4, 32], [4.6, 32]]) {
      const rig = new Rig(humanoidSkeleton(1));
      const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
      anim.setFacing(0);
      const pos = V3(0, 0, 0);
      let stance = 999, swing = -999;
      for (let i = 0; i < 600; i++) {
        pos.z += speed / 60;
        anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
          groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8) });
        rig.updateMatrices();
        if (i < 200) continue;
        for (const k of [0, 1]) {
          const hip = rig.worldPos(k ? 'thighR' : 'thighL', V3());
          const knee = rig.tipPos(k ? 'thighR' : 'thighL', V3());
          const ank = rig.tipPos(k ? 'shinR' : 'shinL', V3());
          const flex = Math.acos(Math.max(-1, Math.min(1,
            V3().subVectors(knee, hip).normalize().dot(V3().subVectors(ank, knee).normalize())))) * D;
          if (anim.feet[k].grounded) stance = Math.min(stance, flex);
          else swing = Math.max(swing, flex);
        }
      }
      assert(stance < cap,
        `at ${speed} m/s the stance knee never straightens past ${stance.toFixed(1)}° of flexion — that is a crouch`);
      // and the swing knee must actually fold, or the leg is a stiff pendulum
      assert(swing > 60,
        `at ${speed} m/s the swing knee only folds to ${swing.toFixed(1)}° — the leg swings stiff`);
      assert(swing > stance * 2.2,
        `at ${speed} m/s the knee barely changes across the cycle (${stance.toFixed(0)}° → ${swing.toFixed(0)}°)`);
      rows.push(`${speed}m/s ${stance.toFixed(1)}°→${swing.toFixed(0)}°`);
    }
    return `${rows.join(', ')} (stance → swing flexion)`;
  });

  check('crab: the DRAWN boot does not skate — measured on the mesh, not the solver', () => {
    // The one the existing slide check structurally cannot see: `f.pos` is a
    // world point copied verbatim, so it reads 0.00mm however hard the boot
    // hung off it is sliding. Measured on the contact vertices of the mesh:
    // 4.66mm/frame at a 1.6 m/s walk and 17.40mm/frame at a 4.6 m/s run —
    // 1.04 m/s of ground speed, 23% of the body's own.
    const rows = [];
    for (const speed of [1.0, 1.6, 2.5, 4.6, 7.45]) {
      const r = march({ speed, build: 'jedi', boots: true, seconds: 8 });
      const mps = r.bootSlip * 60;
      assert(r.bootSlip < 0.004,
        `at ${speed} m/s a boot vertex in contact with the ground moved `
        + `${(r.bootSlip * 1000).toFixed(2)}mm in one frame (${mps.toFixed(2)} m/s)`);
      assert(mps < speed * 0.07 + 0.05,
        `at ${speed} m/s the sole slides at ${mps.toFixed(2)} m/s — `
        + `${(mps / Math.max(speed, 1e-9) * 100).toFixed(0)}% of the body's own speed`);
      rows.push(`${speed}m/s ${(r.bootSlip * 1000).toFixed(2)}mm/frame`);
    }
    return rows.join(', ');
  });

  check('boots: the ankle is a quarter of the way back along the foot, not at the heel', () => {
    // Every offset in buildFoot used to be written forward from the ankle, so
    // the joint sat 14.5mm behind a 214mm boot: 6.8% of the way back, a figure
    // with no heel, balancing on the extreme rear edge of its own soles, and a
    // toe landing 20cm ahead of the point the gait believed it had stepped on.
    const rows = [];
    for (const name of Object.keys(BUILD)) {
      const { rig } = standing(name);
      const ank = rig.worldPos('footL', V3());
      const pts = bonePts(rig, 'footL');
      assert(pts.length, `${name} has no boot mesh`);
      // along the foot's own heading, which is the toe direction
      const dir = V3(0, 1, 0).applyQuaternion(rig.worldQuat('footL', new THREE.Quaternion()));
      dir.y = 0;
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      dir.normalize();
      let heel = Infinity, toe = -Infinity;
      for (const p of pts) {
        const d = V3().subVectors(p, ank).dot(dir);
        heel = Math.min(heel, d); toe = Math.max(toe, d);
      }
      const frac = -heel / (toe - heel);
      assert(frac > 0.18 && frac < 0.34,
        `${name}'s ankle sits ${(frac * 100).toFixed(1)}% of the way back along its boot `
        + `(${(-heel * 1000).toFixed(0)}mm of heel behind a ${((toe - heel) * 1000).toFixed(0)}mm foot)`);
      rows.push(`${name} ${(frac * 100).toFixed(0)}%`);
    }
    return `${rows.join(', ')} of the boot behind the ankle`;
  });

  check('boots: every archetype stands ON the floor, to the same millimetre', () => {
    // Where the sole met the ground fell out of the boot's own thickness while
    // the animator planted the ankle at a flat 0.072·scale regardless, so the
    // two only agreed by accident. Measured standing: trooper -6.9mm (sole
    // through the floor), B2 -5.7mm, jedi +2.2mm, acolyte +5.0mm, B1 +19.4mm.
    const rows = [];
    let lo = Infinity, hi = -Infinity;
    for (const name of Object.keys(BUILD)) {
      const { rig } = standing(name);
      let min = Infinity;
      for (const bn of ['footL', 'footR']) for (const p of bonePts(rig, bn)) min = Math.min(min, p.y);
      assert(min > -0.003, `${name}'s sole is ${(-min * 1000).toFixed(1)}mm into the floor`);
      assert(min < 0.006, `${name} stands ${(min * 1000).toFixed(1)}mm off the floor`);
      lo = Math.min(lo, min); hi = Math.max(hi, min);
      rows.push(`${name} ${(min * 1000).toFixed(2)}mm`);
    }
    assert(hi - lo < 0.003,
      `sole clearance varies ${((hi - lo) * 1000).toFixed(1)}mm across archetypes — it is falling out of boot thickness`);
    return `${rows.join(', ')} (spread ${((hi - lo) * 1000).toFixed(2)}mm)`;
  });

  check('boots: …AND WHILE IT WALKS, which is the other half of the same clause', () => {
    /* THE CHECK ABOVE PASSED THROUGHOUT AND EVERY BOOT IN THE GAME WENT THROUGH
     * THE FLOOR THE MOMENT IT TOOK A STEP.
     *
     * It only ever called `standing()`, and standing is the one pose in which
     * the animator's idealised foot and the boot `buildFoot` actually draws
     * agree: the ankle sits 72mm over a sole 70.9mm below it. Pitch that foot
     * and they stop agreeing, because the underside of the drawn toe is 161.4mm
     * from the ankle where the model's steepest pivot is 151.2mm. Measured over
     * a fifteen-second march, lowest drawn boot vertex, at every speed from 1.0
     * to 7.45 m/s and INDEPENDENT of speed — which is what says geometry rather
     * than a landing dip:
     *
     *     b1 -16.7mm · acolyte -22.7 · jedi -23.6 · trooper -27.4 · b2 -30.1
     *
     * All nineteen humanoids, buried to the laces, in a game whose whole
     * dismemberment mechanic is watched from three metres away.
     *
     * The second thing this covers is SPECIES. `BUILD` is a table of five
     * builders called with no arguments, so every figure this file has ever
     * measured is a 1.78m human — and `jediLook()` gives one enemy Jedi in
     * seven a `smallfolk` frame at 0.40 scale. Nothing about the boot is
     * allowed to be a length in a human's metres. */
    const rows = [];
    const SUBJECTS = [
      ...Object.keys(BUILD).map((n) => [n, {}]),
      ...B.SPECIES.map((sp) => [`jedi/${sp.id}`, { species: sp.id }, 'jedi']),
    ];
    for (const [label, opts, builder] of SUBJECTS) {
      let worst = Infinity, worstAt = 0;
      for (const speed of [1.0, 1.6, 2.5, 4.6, 7.45]) {
        const r = march({ speed, build: builder || label, boots: true, seconds: 8, opts });
        if (r.bootLow < worst) { worst = r.bootLow; worstAt = speed; }
        // The same two bounds the standing clause uses, in the figure's own
        // scale, because a small species is allowed small numbers and is not
        // allowed a different relationship to the floor.
        assert(r.bootLow > -0.003 * r.scale,
          `${label} walking at ${speed} m/s puts its sole ${(-r.bootLow * 1000).toFixed(1)}mm `
          + `through the floor (standing it is clear)`);
        assert(r.bootLow < 0.006 * r.scale,
          `${label} walking at ${speed} m/s floats ${(r.bootLow * 1000).toFixed(1)}mm above the floor`);
      }
      rows.push(`${label} ${(worst * 1000).toFixed(1)}mm@${worstAt}`);
    }
    return rows.join(', ');
  });

  /* ── (b) the cone ──────────────────────────────────────────────────── */

  check('cone: the legs are not the widest thing on the figure', () => {
    // Measured on the built Jedi: the widest point of the front-view outline
    // at every height from y=0.07 to y=0.91 belonged to a LEG — the knee stood
    // at ±24.6cm, wider than the robe hem and wider than the shoulders. A body
    // whose outline is owned by two splayed legs from the ankle to the hip is
    // an A-frame, which is most of what "cone like" was describing.
    const { rig } = standing('jedi');
    const tris = worldTris(rig, new Set(['armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'clavL', 'clavR']));
    const LEG = new Set(['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']);
    let legOwned = 0, total = 0, widestLeg = 0, robeMin = Infinity;
    for (let y = 0.36; y <= 0.86; y += 0.02) {
      const o = outlineAt(tris, y);
      if (!o.hit) continue;
      total++;
      if (LEG.has(o.owner)) { legOwned++; widestLeg = Math.max(widestLeg, o.w); }
      else robeMin = Math.min(robeMin, o.w);
    }
    assert(total > 15, 'not enough outline slices over the robe span');
    assert(legOwned === 0,
      `a leg is the widest point of the outline in ${legOwned}/${total} slices between `
      + `y=0.36 and y=0.86 (out to ${(widestLeg * 100).toFixed(1)}cm) — the robe does not cover it`);
    // and the knee itself must be inside the cloth, not standing through it
    const knee = rig.tipPos('thighL', V3());
    const at = outlineAt(tris, knee.y);
    assert(at.w > Math.abs(knee.x) + 0.05,
      `the robe is only ${(at.w * 100).toFixed(1)}cm wide at knee height with the knee at `
      + `${(Math.abs(knee.x) * 100).toFixed(1)}cm — no room for the joint to swing in`);
    return `robe owns all ${total} slices from y=0.36 to 0.86, narrowest ${(robeMin * 100).toFixed(1)}cm, `
      + `${(at.w * 100).toFixed(1)}cm of cloth around a knee at ${(Math.abs(knee.x) * 100).toFixed(1)}cm`;
  });

  check('cone: the outline has hem STEPS in it, which is what a cone has none of', () => {
    // Folds and shading did not break it: the outline from the hem at y=0.39
    // to the belt at y=0.89 was one monotone ramp sitting 8.14mm rms from a
    // straight line — geometrically a cone, whatever the surface was doing.
    // One garment can only make one ramp. What a layered costume has is an
    // EDGE with a narrower garment continuing below it, and that break is read
    // before anything else about the shape.
    const { rig } = standing('jedi');
    const tris = worldTris(rig, new Set(['armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'clavL', 'clavR']));
    const rows = [];
    for (let y = 0.12; y <= 0.92; y += 0.02) {
      const o = outlineAt(tris, y);
      if (o.hit) rows.push({ y, w: o.w });
    }
    assert(rows.length > 30, 'not enough outline slices');
    // hems: a slice that is more than 15mm wider than the one below it
    const steps = [];
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].w - rows[i - 1].w;
      if (d > 0.015) steps.push({ y: rows[i].y, d });
    }
    assert(steps.length >= 2,
      `the outline has ${steps.length} hem-sized steps in it between y=0.12 and y=0.92 — that is a cone`);
    assert(Math.max(...steps.map(s => s.d)) > 0.03,
      `the largest step in the outline is only ${(Math.max(...steps.map(s => s.d)) * 1000).toFixed(0)}mm`);

    // and it is nowhere near a straight line over the robe
    const seg = rows.filter(r => r.y >= 0.36 && r.y <= 0.92);
    const my = mean(seg.map(r => r.y)), mw = mean(seg.map(r => r.w));
    let num = 0, den = 0;
    for (const r of seg) { num += (r.y - my) * (r.w - mw); den += (r.y - my) ** 2; }
    const k = num / den, c = mw - k * my;
    const rms = Math.sqrt(mean(seg.map(r => (r.w - (k * r.y + c)) ** 2)));
    assert(rms > 0.012,
      `the outline sits ${(rms * 1000).toFixed(2)}mm rms from a straight line over the robe — that is a cone`);
    return `${steps.length} hems (${steps.map(s => `${(s.d * 1000).toFixed(0)}mm@${s.y.toFixed(2)}m`).join(', ')}), `
      + `${(rms * 1000).toFixed(1)}mm rms off a straight line`;
  });

  check('cone: the robe is layered cloth, not one garment with folds on it', () => {
    // A tabard over an under-robe, a wrapped belt with hanging ends, sleeves
    // into bracers, boots with a shaft and a sole. What makes them read as
    // separate garments is that they end at DIFFERENT heights: count the
    // distinct hem lines hanging off the pelvis.
    const { rig } = standing('jedi');
    const hips = rig.get('hips').obj;
    const hemY = [];
    hips.traverse((o) => {
      if (!o.isMesh || o.userData.boneChild) return;
      let a = o.parent, own = true;
      while (a && a !== hips) { if (a.userData.boneChild) { own = false; break; } a = a.parent; }
      if (!own) return;
      o.updateMatrixWorld(true);
      const p = o.geometry.attributes.position;
      let lo = Infinity, hi = -Infinity, wide = 0;
      const v = V3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
        wide = Math.max(wide, Math.abs(v.x));
      }
      // a garment, not a pouch: at least 20cm long and 15cm off the axis
      if (hi - lo > 0.20 && wide > 0.15) hemY.push(lo);
    });
    hemY.sort((a, b) => a - b);
    const distinct = hemY.filter((y, i) => i === 0 || y - hemY[i - 1] > 0.04);
    assert(distinct.length >= 3,
      `only ${distinct.length} distinct hem line(s) below the belt (${hemY.map(y => y.toFixed(2)).join(', ')})`);
    assert(distinct[distinct.length - 1] - distinct[0] > 0.15,
      `every hem ends within ${((distinct[distinct.length - 1] - distinct[0]) * 100).toFixed(0)}cm of the others`);
    return `${distinct.length} hems at y = ${distinct.map(y => y.toFixed(2)).join(', ')}m`;
  });

  check('cone: the cape hangs on the robe, not through it', () => {
    // attachCloak's collider list modelled a body with BARE LEGS — a 13cm
    // thigh, a 10cm shin — while everyone who gets a cloak in this game wears
    // a robe that is a 19-26cm tube round the same legs. So the cloth settled
    // against a surface 6-9cm inside the one you can see: measured on a
    // standing Jedi, particles up to 47mm inside the robe's own surface on 164
    // of 180 frames. A cape passing through a skirt.
    const scene = new THREE.Scene();
    const rig = BUILD.jedi({}).rig;
    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    const cloak = attachCloak(scene, rig, { width: 0.62, length: 1.02 });
    assert(cloak, 'no cloak was built');
    const pos = V3(0, 0, 0);
    const rows = [];
    for (const speed of [0, 1.6]) {
      let worst = 0, bad = 0, frames = 0;
      for (let i = 0; i < 460; i++) {
        pos.z += speed / 60;
        anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
          groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8) });
        rig.updateMatrices();
        cloak.update(1 / 60, cloak.refreshColliders(), V3(Math.sin(i * 0.02) * 0.3, 0, 0));
        if (i < 300) continue;
        frames++;
        // robe surface as a max-radius-per-2cm-band table about the hips axis
        const hips = rig.get('hips').obj;
        const axis = rig.worldPos('hips', V3());
        const tab = new Map();
        hips.traverse((o) => {
          if (!o.isMesh || o.userData.boneChild) return;
          let a = o.parent, own = true;
          while (a && a !== hips) { if (a.userData.boneChild) { own = false; break; } a = a.parent; }
          if (!own) return;
          o.updateMatrixWorld(true);
          const p = o.geometry.attributes.position, v = V3();
          for (let j = 0; j < p.count; j++) {
            v.fromBufferAttribute(p, j).applyMatrix4(o.matrixWorld);
            const b = Math.floor(v.y / 0.02);
            tab.set(b, Math.max(tab.get(b) ?? 0, Math.hypot(v.x - axis.x, v.z - axis.z)));
          }
        });
        let any = false;
        for (let k = 0; k < cloak.pos.length; k += 3) {
          const rr = tab.get(Math.floor(cloak.pos[k + 1] / 0.02));
          if (rr === undefined) continue;
          const d = rr - Math.hypot(cloak.pos[k] - axis.x, cloak.pos[k + 2] - axis.z);
          if (d > worst) worst = d;
          if (d > 0.01) any = true;
        }
        if (any) bad++;
      }
      assert(worst < 0.025,
        `at ${speed} m/s a cloak particle sat ${(worst * 1000).toFixed(0)}mm inside the robe's own surface`);
      assert(bad < frames * 0.1,
        `the cape is inside the robe on ${bad}/${frames} frames at ${speed} m/s`);
      rows.push(`${speed}m/s ${(worst * 1000).toFixed(0)}mm on ${bad}/${frames} frames`);
    }
    return rows.join(', ');
  });

  check('cone: the pelvis counter-rotates enough to read as a walk', () => {
    // 6.3° of transverse rotation at a walk against a human ~10°. A pelvis
    // that barely turns is a pelvis being carried sideways, which is the other
    // half of the crab read.
    const e = new THREE.Euler();
    const rows = [];
    for (const [speed, lo, hi] of [[1.6, 8, 16], [4.6, 10, 22]]) {
      const rig = new Rig(humanoidSkeleton(1));
      const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
      anim.setFacing(0);
      const pos = V3(0, 0, 0);
      const yaws = [];
      for (let i = 0; i < 540; i++) {
        pos.z += speed / 60;
        anim.update(1 / 60, { position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
          groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8) });
        rig.updateMatrices();
        if (i > 150) { e.setFromQuaternion(rig.worldQuat('hips', new THREE.Quaternion()), 'YXZ'); yaws.push(e.y); }
      }
      const deg = range(yaws) * D;
      assert(deg > lo, `the pelvis turns only ${deg.toFixed(1)}° over a stride at ${speed} m/s`);
      assert(deg < hi, `the pelvis turns ${deg.toFixed(1)}° at ${speed} m/s — that is a twist, not a walk`);
      rows.push(`${speed}m/s ${deg.toFixed(1)}°`);
    }
    return rows.join(', ');
  });
}
