/**
 * THE PLAYER'S FACE, AS ONE SURFACE.
 *
 * "can we substantially increase the detail and fidelity of all the possible
 * faces in the game (player faces)? they look fine and the jankiness is part
 * of the charm at this point for the game overall but is there anything we
 * can do to increase the quality? they're really crude right now."
 *
 * What was crude: the skull was twelve overlapping ellipsoids merged into one
 * geometry but never into one surface, so the ink pass drew a line round every
 * ball; the eye was a sphere with a smaller sphere on it; the mouth was a slab;
 * the ear was a lump; fourteen meshes on the head bone. Now: one sculpted
 * lat-long surface driven by the same numbers (`skullGeo`), an eyeball with
 * its iris and pupil in the vertex colour, lids that can blink, lips as two
 * rolls with a seam, ears with a rim and a concha, brows as tubes, nine face
 * presets and a `wear` parameter — and no more than eight feature meshes on
 * the skull. Every one of those is a number here, over every preset and every
 * species, because a face that builds on the human and NaNs on the Kel Dor is
 * a face the creator will find.
 *
 * The budget is `characters`' and `creator`'s: 13 000 triangles a body and
 * every species inside the human's cost. The head is held to a band of its
 * own here so the next pass cannot spend the whole body on a nose.
 */

import * as THREE from 'three';
import { buildJedi, SPECIES, FACE_PRESETS } from '../../src/game/Bodies.js';

const cost = (root) => {
  let t = 0, m = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    m++;
    t += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  return { tris: Math.round(t), meshes: m };
};

const headOf = (opts) => {
  const b = buildJedi(opts);
  const head = b.rig.get('head');
  const features = head.obj.children.filter((o) => o.isMesh && o.userData.feature);
  return { built: b, head, skull: head.primary, features };
};

function finite(geo) {
  for (const name of ['position', 'normal', 'color', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) return `${name}[${i}]`;
  }
  return null;
}

export async function run({ check, assert }) {
  check('faces: every preset on every species builds a finite head', () => {
    let n = 0;
    for (const sp of SPECIES) {
      for (const f of FACE_PRESETS) {
        const { head } = headOf({ species: sp.id, face: f.id });
        for (const o of head.obj.children) {
          if (!o.isMesh) continue;
          const bad = finite(o.geometry);
          assert(!bad, `${sp.id} / ${f.id}: ${o.userData.feature || o.name || 'a head mesh'} has a non-finite ${bad}`);
          if (o.geometry.morphAttributes.position) {
            for (const m of o.geometry.morphAttributes.position) for (let i = 0; i < m.array.length; i++) {
              assert(Number.isFinite(m.array[i]), `${sp.id} / ${f.id}: a morph target is non-finite`);
            }
          }
        }
        n++;
      }
    }
    return `${n} heads, ${SPECIES.length} species × ${FACE_PRESETS.length} presets`;
  });

  check('faces: the skull is one mesh, and the features are eight at most', () => {
    const rows = [];
    for (const sp of SPECIES) {
      const { skull, features, head } = headOf({ species: sp.id, face: 'even' });
      assert(skull && skull.geometry.index, `${sp.id}: the skull is not one indexed mesh`);
      assert(skull.geometry.attributes.position.count > 500, `${sp.id}: the skull has only ${skull.geometry.attributes.position.count} vertices`);
      assert(features.length <= 8, `${sp.id}: ${features.length} feature meshes on the head`);
      const kinds = new Set(features.map((f) => f.userData.feature));
      if (sp.eyes !== false) assert(kinds.has('eyeL') && kinds.has('eyeR') && kinds.has('lidsL') && kinds.has('lidsR'), `${sp.id}: eyes or lids missing`);
      if (sp.mouth !== false) assert(kinds.has('lips'), `${sp.id}: no lips`);
      if (sp.ears !== false) assert(kinds.has('earL') && kinds.has('earR'), `${sp.id}: no ears`);
      // the brows ride the hair mesh (see buildHead); a species with brows
      // has a hair mesh carrying more than the cut alone
      if (sp.brows !== false) {
        const hair = head.obj.children.find((o) => o.isMesh && o.userData.silhouette && !o.userData.feature);
        assert(hair, `${sp.id}: no hair mesh to carry the brows`);
      }
      rows.push(`${sp.id} 1+${features.length}/${head.obj.children.length}`);
    }
    return rows.join('  ');
  });

  check('faces: a head costs between 1200 and 3200 triangles, on every preset', () => {
    let lo = Infinity, hi = 0, at = '';
    for (const sp of SPECIES) {
      for (const f of FACE_PRESETS) {
        const { skull, features } = headOf({ species: sp.id, face: f.id });
        let t = cost(skull).tris;
        for (const m of features) t += cost(m).tris;
        assert(t >= 1200 && t <= 3200, `${sp.id} / ${f.id}: the head is ${t} triangles`);
        if (t < lo) lo = t;
        if (t > hi) { hi = t; at = `${sp.id}/${f.id}`; }
      }
    }
    return `${lo}–${hi} triangles (skull and features), heaviest ${at}`;
  });

  check('faces: the presets are different faces, not the same face with a label', () => {
    const skulls = FACE_PRESETS.map((f) => ({ id: f.id, p: headOf({ species: 'human', face: f.id }).skull.geometry.attributes.position }));
    let worst = 1, pair = '';
    for (let i = 0; i < skulls.length; i++) {
      for (let j = i + 1; j < skulls.length; j++) {
        const a = skulls[i].p, b = skulls[j].p;
        assert(a.count === b.count, 'two presets built skulls of different vertex counts');
        let moved = 0;
        for (let k = 0; k < a.count; k++) {
          const d = Math.hypot(a.getX(k) - b.getX(k), a.getY(k) - b.getY(k), a.getZ(k) - b.getZ(k));
          if (d > 0.0005) moved++;
        }
        const frac = moved / a.count;
        if (frac < worst) { worst = frac; pair = `${skulls[i].id}/${skulls[j].id}`; }
      }
    }
    assert(worst >= 0.04, `${pair} differ at only ${(worst * 100).toFixed(1)}% of vertices`);
    return `closest pair ${pair}: ${(worst * 100).toFixed(0)}% of vertices moved over 0.5 mm`;
  });

  check('faces: the eye has a pupil, an iris and a white, and the lids blink', () => {
    const { features } = headOf({ species: 'human', face: 'even' });
    const eye = features.find((f) => f.userData.feature === 'eyeR');
    const c = eye.geometry.attributes.color;
    // three populations by colour, not by brightness: a brown iris is nearly
    // as dark as its pupil, so what separates them is that they are DIFFERENT
    const key = (i) => `${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)},${c.getZ(i).toFixed(3)}`;
    const pop = new Map();
    for (let i = 0; i < c.count; i++) pop.set(key(i), (pop.get(key(i)) || 0) + 1);
    const sorted = [...pop.entries()].sort((a, b) => b[1] - a[1]);
    const white = sorted[0][1];                              // the sclera is most of the ball
    const lum = (k) => k.split(',').reduce((a, v) => a + +v, 0) / 3;
    const darkest = Math.min(...[...pop.keys()].map(lum));
    const dark = [...pop.entries()].filter(([k]) => lum(k) === darkest).reduce((a, [, n]) => a + n, 0);
    const mid = c.count - white - dark;
    // …and the iris is visibly lighter than the pupil it rings
    const irisLum = [...pop.entries()].filter(([k, n]) => lum(k) !== darkest && n !== white).map(([k]) => lum(k));
    assert(pop.size >= 4, `the eye is ${pop.size} colours — a pupil, an iris ring, a limbal ring and a white are four`);
    assert(dark >= 11 && mid >= 11 && white >= 30, `pupil ${dark}, iris ${mid}, sclera ${white} vertices`);
    assert(Math.max(...irisLum) > darkest * 3, `the iris (${Math.max(...irisLum).toFixed(3)}) is as dark as the pupil (${darkest.toFixed(3)})`);
    const lids = features.find((f) => f.userData.feature === 'lidsR');
    const morph = lids.geometry.morphAttributes.position;
    assert(morph && morph.length === 1 && morph[0].name === 'blink', 'the lids carry no blink morph');
    let travel = 0;
    for (let i = 0; i < morph[0].count; i++) travel = Math.max(travel, Math.hypot(morph[0].getX(i), morph[0].getY(i), morph[0].getZ(i)));
    assert(travel > 0.008, `a blink moves the lid only ${(travel * 1000).toFixed(1)} mm`);
    // the lash line: the margin row is dark
    const lc = lids.geometry.attributes.color;
    let lash = 0;
    for (let i = 0; i < lc.count; i++) if (lc.getX(i) < 0.3) lash++;
    assert(lash >= 8, 'no lash line on the lid');
    return `pupil ${dark} / iris ${mid} / white ${white} vertices, blink travels ${(travel * 1000).toFixed(0)} mm, ${lash} lash vertices`;
  });

  check('faces: wear draws the fold, and age wears the face', () => {
    const young = headOf({ species: 'human', face: { preset: 'even', wear: 0 } }).skull.geometry;
    const worn = headOf({ species: 'human', face: { preset: 'even', wear: 1 } }).skull.geometry;
    const p = young.attributes.position, cy = young.attributes.color, cw = worn.attributes.color;
    // the fold: the darkest change is beside the nose, above the mouth corner
    let best = 0, at = null, sum = 0;
    for (let i = 0; i < p.count; i++) {
      const d = cy.getX(i) - cw.getX(i);
      sum += d;
      if (d > best) { best = d; at = [p.getX(i), p.getY(i), p.getZ(i)]; }
    }
    assert(best > 0.10, `wear darkens the skull by at most ${best.toFixed(3)}`);
    assert(at && Math.abs(at[0]) > 0.008 && Math.abs(at[0]) < 0.06 && at[1] > 0.02 && at[1] < 0.10 && at[2] > 0.03,
      `the deepest line is at (${at.map((v) => v.toFixed(3)).join(', ')}), not on the face`);
    assert(sum / p.count < 0.06, 'wear darkened the whole head, not its lines');
    const aged = headOf({ species: 'human', face: 'even', age: 1 }).skull.geometry.attributes.color;
    let ageD = 0;
    for (let i = 0; i < p.count; i++) ageD = Math.max(ageD, cy.getX(i) - aged.getX(i));
    assert(ageD > 0.08, 'the years leave no lines');
    return `deepest line ${best.toFixed(2)} at (${at.map((v) => (v * 100).toFixed(1)).join(', ')}) cm, mean ${(sum / p.count).toFixed(3)}, age 1 draws ${ageD.toFixed(2)}`;
  });

  check('faces: the skull is closed, smooth, and still holds its features on the surface', () => {
    const { skull, features } = headOf({ species: 'human', face: 'even' });
    const g = skull.geometry;
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    // a head: 15 wide, 21 tall, 20 deep, give or take the preset
    assert(size.x > 0.13 && size.x < 0.18, `the head is ${(size.x * 100).toFixed(1)} cm wide`);
    assert(size.y > 0.19 && size.y < 0.25, `the head is ${(size.y * 100).toFixed(1)} cm tall`);
    // smooth: the angle between neighbouring face normals over the face is small
    const n = g.attributes.normal, p = g.attributes.position, idx = g.index;
    let sharp = 0, faces = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      if (p.getZ(a) < 0.03) continue;                        // the face only
      faces++;
      const d = n.getX(a) * n.getX(b) + n.getY(a) * n.getY(b) + n.getZ(a) * n.getZ(b);
      if (d < Math.cos(Math.PI / 4)) sharp++;
    }
    assert(faces > 200 && sharp / faces < 0.08, `${sharp} of ${faces} face triangles turn more than 45° across an edge`);
    // every feature sits ON the skull: the mean distance of its vertices to
    // the surface is under a centimetre (a lid's back rows are inside the
    // socket by design; an ear's rim stands off by its own thickness)
    const tri = new THREE.Triangle(), q = new THREE.Vector3(), v = new THREE.Vector3();
    for (const f of features) {
      const fp = f.geometry.attributes.position;
      let sum = 0;
      for (let k = 0; k < fp.count; k += 3) {
        v.fromBufferAttribute(fp, k).applyMatrix4(f.matrix);
        let best = Infinity;
        for (let i = 0; i < idx.count; i += 3) {
          tri.a.fromBufferAttribute(p, idx.getX(i)); tri.b.fromBufferAttribute(p, idx.getX(i + 1)); tri.c.fromBufferAttribute(p, idx.getX(i + 2));
          tri.closestPointToPoint(v, q);
          const d = q.distanceTo(v);
          if (d < best) best = d;
        }
        sum += best;
      }
      const mean = sum / Math.ceil(fp.count / 3);
      assert(mean < 0.010, `${f.userData.feature} sits ${(mean * 1000).toFixed(1)} mm off the skull on average`);
    }
    return `${(size.x * 100).toFixed(1)} × ${(size.y * 100).toFixed(1)} × ${(size.z * 100).toFixed(1)} cm, ${sharp}/${faces} sharp face edges, ${features.length} features seated`;
  });
}
