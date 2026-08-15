/**
 * BATTLEFRONT BORZ — the two ends of the belt.
 *
 * THE BUG. Bodies.js built them, and its own comment said why: "the hanging
 * ends are the point: a closed ring round a waist is a hoop, and every
 * reference for this character has cloth falling off the front of the belt."
 * Two rigid straps off the knot, at a radius of 104-147mm on the hips bone.
 *
 * The garment over them starts at 145mm and reaches 285 by its hem. Measured on
 * a built Jedi, 0 of their 90 vertices were outside the robe and the deepest sat
 * 134mm inside it. The detail the comment calls the point drew NOTHING — not
 * one pixel, at any range, on any robed character in the game, since the day the
 * robe below the belt became cloth.
 *
 * It is a good example of the class of bug this project keeps finding: every
 * number was right, the geometry built, the material bound, the triangles
 * uploaded and drawn, and the picture had no belt ends in it. Nothing that
 * counts things could see it.
 *
 * WHY IT COULD NOT BE FIXED BY MOVING THEM OUT. There is no radius that works.
 * Under a simulated robe the surface they have to clear swings 80mm at a walk,
 * so a rigid strap outside it at rest is inside it a third of a second later;
 * and one far enough out to clear the swing is a plank hanging in the air beside
 * a moving garment — the exact defect ("a hem vertex travels 0.000 mm in the
 * pelvis frame while the cape's travels 217") that put the robe in Cloth.js in
 * the first place. A strap that lies on cloth has to be cloth.
 *
 * So: attachSash, two narrow closed tubes on the belt, owned and stepped by the
 * skirt they lie on. What is measured here is the pair of claims that makes
 * that worth doing — they are OUTSIDE the robe, and they are ALIVE in the
 * pelvis frame — plus the wiring, because a garment nobody hides, carries,
 * kicks or disposes is a leak with a nice silhouette.
 *
 * THE MEASUREMENT TOOK FOUR TRIES, and the three that were wrong are worth
 * writing down because each was wrong in a way that reads as a finding:
 *
 *   radius against height, against the robe's own rows. Reported 22% of the
 *   strap buried at a stand. It was comparing a strap in a fold VALLEY against
 *   a ridge 20° away that does not overlap it.
 *
 *   radius against height, interpolated to the strap's own bearing. Reported
 *   23% buried at a sprint. At a sprint the garment streams to a 725mm radius
 *   on one side and 50 on the other, and no radius-against-height function
 *   describes that shape at all.
 *
 *   signed distance to the NEAREST TRIANGLE. Reported 10% buried at a sprint,
 *   with the deepest point 300mm from any cloth. "Which side of the nearest
 *   triangle" is a good question about a closed tube and a meaningless one
 *   about an open sheet flying past.
 *
 * What is here now caps the tube at both ends and counts ray crossings, which
 * is containment rather than a proxy for it, and it holds whatever shape the
 * cloth has taken. Every wrong version measured its own assumption; two of them
 * would have been believed if they had happened to agree with the code.
 */

import * as THREE from 'three';
import { buildJedi, limbGeo } from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';
import { attachCloak, attachSkirt } from '../../src/game/Cloth.js';
import { weave, weaveLine } from './_weave.mjs';

/* ── the bench ───────────────────────────────────────────────────────── */

/** A Jedi walking in a straight line, in a robe with a belt on it. */
function drive({ speed = 1.6, seconds = 6, tail = 20, sample = null } = {}) {
  const built = buildJedi({ scale: 1 });
  const rig = built.rig;
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const scene = new THREE.Scene();
  const skirt = attachSkirt(scene, rig, { seed: 991, rigid: built.robeSkirt,
    sashMaterial: built.palette.trim });
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(0, 0, speed);
  const wind = new THREE.Vector3();
  const N = Math.round(seconds * 60);
  for (let i = 0; i < N; i++) {
    pos.z += speed / 60;
    anim.update(1 / 60, { position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0 });
    anim.swingArms(1 / 60, speed, 1);
    rig.updateMatrices();
    wind.set(0, 0, -speed * 0.85);
    skirt.update(1 / 60, skirt.refreshColliders(), wind);
    if (sample && i >= N - tail) sample({ rig, skirt, hips: rig.get('hips').obj });
  }
  return { built, rig, scene, skirt };
}

const _t = new THREE.Triangle(), _q = new THREE.Vector3();

/**
 * The robe as a CLOSED volume: its own quads, plus a fan across the waistband
 * and a fan across the hem.
 *
 * The caps are what turn "which side of a surface" — the question that failed
 * three times above — into "in or out of a volume", which has an answer for any
 * shape. Built off the particle grid rather than off `skirt.mesh.geometry`, so
 * the winding and the duplicated seam column are this file's own business.
 */
function robeVolume(sk) {
  const out = [];
  const P = (r, c) => {
    const i = (r * sk.cols + (c % sk.cols)) * 3;
    return new THREE.Vector3(sk.pos[i], sk.pos[i + 1], sk.pos[i + 2]);
  };
  for (let r = 0; r < sk.rows - 1; r++) {
    for (let c = 0; c < sk.cols; c++) {
      out.push([P(r, c), P(r, c + 1), P(r + 1, c + 1)]);
      out.push([P(r, c), P(r + 1, c + 1), P(r + 1, c)]);
    }
  }
  for (const r of [0, sk.rows - 1]) {
    const mid = new THREE.Vector3();
    for (let c = 0; c < sk.cols; c++) mid.add(P(r, c));
    mid.multiplyScalar(1 / sk.cols);
    for (let c = 0; c < sk.cols; c++) out.push([mid, P(r, c), P(r, c + 1)]);
  }
  return out;
}

/** Möller–Trumbore, two-sided, used only for a crossing count. */
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _pv = new THREE.Vector3(), _tv = new THREE.Vector3(), _qv = new THREE.Vector3();
function hits(tri, o, d) {
  const e1 = _e1.subVectors(tri[1], tri[0]);
  const e2 = _e2.subVectors(tri[2], tri[0]);
  const pv = _pv.crossVectors(d, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const tv = _tv.subVectors(o, tri[0]);
  const u = tv.dot(pv) * inv;
  if (u < 0 || u > 1) return false;
  const qv = _qv.crossVectors(tv, e1);
  const vv = d.dot(qv) * inv;
  if (vv < 0 || u + vv > 1) return false;
  return e2.dot(qv) * inv > 1e-9;
}

const RAY = new THREE.Vector3(0.577, 0.331, 0.746).normalize();
const inside = (vol, p) => {
  let n = 0;
  for (const tri of vol) if (hits(tri, p, RAY)) n++;
  return (n & 1) === 1;
};

/** Nearest distance from a point to the robe's surface, unsigned. */
function nearest(vol, p) {
  let best = 1e9;
  for (const tri of vol) {
    _t.set(tri[0], tri[1], tri[2]);
    _t.closestPointToPoint(p, _q);
    best = Math.min(best, p.distanceTo(_q));
  }
  return best;
}

/** How much of the sash is inside the robe, over the tail of a walk at `speed`. */
function clearance(speed) {
  let deepest = 0, buried = 0, n = 0;
  const v = new THREE.Vector3();
  const rig = drive({ speed, tail: 24, sample: ({ skirt: sk }) => {
    const vol = robeVolume(sk);
    for (const strap of sk.sash.parts) {
      const p = strap.pos, m = strap.cols * strap.rows;
      // from row 1: row 0 is the pinned ring on the belt, which is under the
      // waistband on purpose — a sash is tied, not glued on the outside.
      for (let k = strap.cols; k < m; k++) {
        v.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
        if (inside(vol, v)) { buried++; deepest = Math.max(deepest, nearest(vol, v)); }
        n++;
      }
    }
  } });
  return { deepest, pct: 100 * buried / n, n, rig };
}

/* ── the checks ──────────────────────────────────────────────────────── */

export async function run({ check, assert }) {
  check('sash: the belt has two ends, and they are cloth', () => {
    const { skirt, built } = drive({ seconds: 1 });
    assert(skirt.sash, 'the skirt hands back no sash — the belt is a closed hoop again');
    assert(skirt.sash.parts.length === 2,
      `the knot ties ${skirt.sash.parts.length} ends; a knot has two, one long and one short`);
    const [a, b] = skirt.sash.parts;
    assert(a.pos && a.links.length > 0 && b.pos, 'the ends carry no particles — they are not simulated');
    assert(Math.abs(a.length - b.length) > 0.04,
      `both ends are ${a.length.toFixed(2)} m long — a knot ties a long end and a short one, and two `
      + 'identical straps read as a costume nobody looked at');
    // …and the rigid pair is gone rather than hidden underneath.
    let strays = 0;
    built.rig.get('hips').obj.traverse((o) => {
      if (o.isMesh && o.material === built.palette.trim && o.geometry.attributes.position.count === 45) strays++;
    });
    assert(strays === 0, `${strays} rigid 45-vertex belt straps are still built under the robe`);
    skirt.dispose();
    return `${a.length.toFixed(2)} m and ${b.length.toFixed(2)} m of cloth off the knot, `
      + `${a.cols * a.rows + b.cols * b.rows} particles`;
  });

  check('sash: the ends hang OUTSIDE the robe, at a stand and at a walk', () => {
    /**
     * THE BUG, measured. On the tree this replaces the answer was 100% inside
     * and 134mm deep, because the straps were welded to the pelvis at a radius
     * the garment covers. A strap is either outside the cloth or it does not
     * exist, and there is no third state a player can see.
     *
     * Zero tolerance on the fraction and −6mm on the worst point: the strap is
     * 9mm thick and the robe's own quads are 78mm apart, so a millimetre or two
     * of a moving fold crossing a moving strap is the mesh's resolution rather
     * than a garment eating another one.
     */
    const rows = [];
    for (const speed of [0, 1.6]) {
      const c = clearance(speed);
      rows.push(`${speed} m/s: ${c.pct.toFixed(1)}% of ${c.n} samples inside`);
      assert(c.pct < 2,
        `${c.pct.toFixed(1)}% of the sash is inside the robe at ${speed} m/s — it is being worn under it`);
      assert(c.deepest < 0.03,
        `the sash reaches ${(c.deepest * 1000).toFixed(0)}mm into the robe at ${speed} m/s`);
      c.rig.skirt.dispose();
    }
    return rows.join('; ');
  });

  check('sash: …and at a sprint, which is where the robe stops being a cone', () => {
    /* Separate, and looser, because 7.4 m/s — 4.6 × the 1.62 sprint multiplier
     * in Player._move, the fastest a player moves without a boon — is where the
     * garment streams almost horizontally and the two of them genuinely cross.
     * It measures 0.0% over 3600 samples, the same as a stand; the bar is 3%
     * rather than the walk's 2 because this is the case where the garment and
     * the strap genuinely cross paths, and a few frames under a flying hem is a
     * sprint rather than a defect. */
    const c = clearance(7.4);
    assert(c.pct < 3,
      `${c.pct.toFixed(1)}% of the sash is inside the robe at a sprint`);
    return `${c.pct.toFixed(1)}% of ${c.n} samples inside at 7.4 m/s, deepest `
      + `${(c.deepest * 1000).toFixed(0)}mm`;
  });

  check('sash: and they are not welded to the pelvis', () => {
    /* The metric the whole of Cloth.js is built on: a rigid strap travels
     * 0.000 mm in the pelvis frame however hard its owner runs, because it is
     * the pelvis. Anything above a few centimetres is cloth. */
    const tips = [];
    const v = new THREE.Vector3(), inv = new THREE.Matrix4();
    const r = drive({ speed: 4.6, tail: 150, sample: ({ skirt: sk, hips }) => {
      hips.updateMatrixWorld(true);
      inv.copy(hips.matrixWorld).invert();
      const strap = sk.sash.parts[0];
      const t = (strap.rows - 1) * strap.cols;
      v.set(strap.pos[t * 3], strap.pos[t * 3 + 1], strap.pos[t * 3 + 2]).applyMatrix4(inv);
      tips.push(v.clone());
    } });
    const mean = tips.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / tips.length);
    let spread = 0;
    for (const q of tips) spread = Math.max(spread, q.distanceTo(mean));
    assert(spread > 0.04,
      `the sash tip moved ${(spread * 1000).toFixed(1)}mm in the pelvis frame over two and a half `
      + 'seconds of running — it is welded to the hips, which is the whole bug this replaces');
    // …and it hangs DOWN rather than standing off: a strap that has been thrown
    // above its own root by the solver is not a strap.
    assert(mean.y < 0, `the sash tip sits ${(mean.y * 1000).toFixed(0)}mm ABOVE the belt it hangs from`);
    r.skirt.dispose();
    return `tip travels ${(spread * 1000).toFixed(0)}mm in the pelvis frame at a run, hanging `
      + `${(-mean.y * 100).toFixed(0)}cm below the knot`;
  });

  check('sash: the skirt that owns it hides it, carries it, kicks it and disposes it', () => {
    /* attachSash is not wired at any call site — the skirt owns it, so that
     * Player, Enemy and the creator preview drive it through the six seams they
     * already drive a skirt through. Which means those six seams are exactly
     * what can silently stop working. */
    const { skirt, scene } = drive({ seconds: 1 });
    const parts = skirt.sash.parts;
    skirt.setVisible(false);
    assert(parts.every((p) => !p.mesh.visible),
      'switching the robe off at range leaves the sash simulating in mid-air');
    skirt.setVisible(true);
    assert(parts.every((p) => p.mesh.visible), 'the sash did not come back with the robe');

    // carried: a body turning through a whole revolution moves the cloth's
    // frame, and cloth left behind reads as a diving board — see Cloak.carry.
    const before = parts[0].pos.slice();
    skirt.carry(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.4),
      new THREE.Vector3(0, 1, 0));
    let moved = 0;
    for (let i = 0; i < before.length; i++) moved = Math.max(moved, Math.abs(parts[0].pos[i] - before[i]));
    assert(moved > 0.01, 'a somersault carries the robe and leaves the sash behind');

    // kicked: every Force power in Player kicks the skirt, and a sash that does
    // not answer a Force push is a decal.
    const prev = parts[0].prev.slice();
    skirt.impulse(new THREE.Vector3(0, 1, 0), 2.4, 1 / 60);
    let kicked = 0;
    for (let i = 0; i < prev.length; i++) kicked = Math.max(kicked, Math.abs(parts[0].prev[i] - prev[i]));
    assert(kicked > 1e-5, 'a Force push moves the robe and not the belt hanging off it');

    const meshes = parts.map((p) => p.mesh);
    assert(meshes.every((m) => scene.children.includes(m)), 'the sash was never added to the scene');
    skirt.dispose();
    assert(meshes.every((m) => !scene.children.includes(m)),
      'disposing the robe leaves the sash in the scene — a garment leak per respawn');
    return 'hidden, shown, carried, kicked and disposed with the robe';
  });

  check('sash: it costs less than the rigid pair it replaces, and far less than the cape', () => {
    /**
     * The lekku's rule, for the lekku's reason: a strap is 0.02 m² against the
     * cape's 0.46, so every per-area number would be flattered by making it
     * FATTER, and holding it to the cape's cell size would come out as a
     * three-sided prism. The bound is absolute, against the cape the same
     * character runs on the same frame, and every per-area number is printed.
     *
     * The rigid pair is rebuilt here rather than quoted, because a number in a
     * comment is a number nobody re-derives: `limbGeo(0.30, 0.030, 0.020, 8,
     * false, { rings: 5 })` is exactly what Bodies.js called, twice.
     */
    const built = buildJedi({ scale: 1 });
    built.rig.updateMatrices(); built.rig.root.updateMatrixWorld(true);
    const cape = attachCloak(new THREE.Scene(), built.rig,
      { width: 0.36, length: 0.86, cols: 9, rows: 11 });
    const C = weave(cape);
    const skirt = attachSkirt(new THREE.Scene(), built.rig, { rigid: built.robeSkirt });
    skirt.update(1 / 60, skirt.refreshColliders(), new THREE.Vector3());
    const parts = skirt.sash.parts;
    const W = weave(parts[0], { tube: true });

    const n = parts.reduce((a, p) => a + p.cols * p.rows, 0);
    const links = parts.reduce((a, p) => a + p.links.length, 0);
    const tests = parts.reduce((a, p) => a + p.cols * p.rows * p.refreshColliders().length, 0);
    const tris = parts.reduce((a, p) => a + p.geometry.index.count / 3, 0);
    const capeTests = C.n * C.colliders;

    assert(n < C.n, `the pair is ${n} particles against the cape's ${C.n}`);
    assert(links < cape.links.length, `the pair is ${links} links against the cape's ${cape.links.length}`);
    assert(tests < capeTests, `the pair costs ${tests} sphere tests a pass against the cape's ${capeTests}`);
    for (const p of parts) {
      assert(p.iterations === cape.iterations, `a strap solves ${p.iterations} passes, not the cape's ${cape.iterations}`);
      assert(p.links.length / (p.cols * p.rows) <= cape.links.length / C.n * 1.1,
        `a strap costs ${(p.links.length / (p.cols * p.rows)).toFixed(2)} links a particle `
        + `against the cape's ${(cape.links.length / C.n).toFixed(2)}`);
      assert(p.refreshColliders().length <= 12,
        `a strap carries ${p.refreshColliders().length} colliders — the robe's own rows and nothing else`);
    }

    let rigidTris = 0;
    for (const len of [0.30, 0.22]) {
      const g = limbGeo(len, 0.030, 0.020, 8, false, { rings: 5 });
      rigidTris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      g.dispose();
    }
    assert(tris < rigidTris,
      `the simulated pair draws ${tris} triangles to replace ${rigidTris} rigid ones, so the swap `
      + 'costs triangles as well as a solve');

    const line = `pair ${n} particles / ${links} links / ${tests} sphere tests a pass against the cape's `
      + `${C.n} / ${cape.links.length} / ${capeTests}; ${tris} tris for the rigid pair's ${rigidTris}; `
      + `a strap is ${weaveLine(W)}`;
    cape.dispose(); skirt.dispose();
    return line;
  });
}
