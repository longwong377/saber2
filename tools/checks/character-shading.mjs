/**
 * Character surface checks — the vertex-colour occlusion channel and the
 * limb profiles that hang off it, in src/game/Bodies.js.
 *
 * These characters are lit by one sun and one hemisphere fill, and a
 * MeshStandardMaterial with no aoMap has no way to know that the inside of an
 * elbow sees a tenth of the sky the outside of it does. There is no second UV
 * set to hang an aoMap on and no room in the budget to bake one, so the creases
 * are baked per vertex instead. That buys three new ways to be wrong, and this
 * file pins all three:
 *
 *   · a material that declares `vertexColors` over a geometry that carries none
 *     does NOT fall back to white — three leaves the attribute unbound and the
 *     mesh renders BLACK. The cut path is the dangerous one: Ragdoll rebuilds a
 *     severed stub by calling straight back into limbGeo with no options, so
 *     limbGeo has to hand out the channel unasked;
 *   · occlusion that is baked but is everywhere 1.0 is a no-op nobody notices,
 *     which is exactly how a castShadow flag once sat in this codebase as a
 *     silent no-op for months;
 *   · limbGeo's multi-swell profile has to meet its caps at exactly r0 and r1,
 *     or a limb severed at 62% rebuilds into a stub that does not line up with
 *     the piece that fell off it.
 */

import * as B from '../../src/game/Bodies.js';

const BUILD = {
  jedi: (o) => B.buildJedi(o), b1: (o) => B.buildB1(o), b2: (o) => B.buildB2(o),
  trooper: (o) => B.buildTrooper(o), acolyte: (o) => B.buildAcolyte(o),
};
const ALL = Object.keys(BUILD);
const CACHE = new Map();
function unit(name) {
  if (!CACHE.has(name)) CACHE.set(name, BUILD[name]({}));
  return CACHE.get(name);
}

/** Mean vertex-colour value over the vertices inside a local-space box. */
function shadeIn(geo, box) {
  const c = geo.attributes.color, p = geo.attributes.position;
  if (!c) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < c.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x < box[0] || x > box[1] || y < box[2] || y > box[3] || z < box[4] || z > box[5]) continue;
    sum += c.getX(i); n++;
  }
  return n ? { mean: sum / n, n } : null;
}

export function run({ check, assert, near, THREE }) {

  check('shading: no material asks for vertex colours a geometry cannot give', () => {
    // The failure mode is not subtle and it is not partial: the mesh goes
    // solid black. Every archetype, every mesh, no exceptions — including the
    // merged assemblies (hands, boots, head shells, Kit buckets), which pick
    // their attributes up from whichever part happened to have them.
    let vc = 0, total = 0;
    const bad = [];
    for (const name of ALL) {
      const u = unit(name);
      u.rig.root.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.material) return;
        total++;
        if (!o.material.vertexColors) return;
        vc++;
        if (!o.geometry.attributes.color) bad.push(`${name}/${o.parent?.name || '?'}`);
      });
    }
    assert(bad.length === 0, `${bad.length} meshes would render black: ${bad.slice(0, 4).join(', ')}`);
    assert(vc >= 20, `only ${vc} of ${total} character meshes carry the occlusion channel`);
    return `${vc}/${total} meshes on vertex-coloured materials, all with a colour attribute`;
  });

  check('shading: a limb rebuilt by the cut path still has the channel', () => {
    // Ragdoll.js severs a bone by disposing the limb's geometry and calling
    // limbGeo(keepLen, r0, rCut, seg, true) — no options, no colour asked for
    // — then hangs the ORIGINAL material on it. If limbGeo does not hand out a
    // neutral channel unasked, every severed arm in the game is a black stub.
    const g = B.limbGeo(0.2, 0.05, 0.04, 10, true);
    const c = g.attributes.color;
    assert(c, 'limbGeo emitted no colour attribute — a severed stub would render black');
    let lo = 1;
    for (let i = 0; i < c.count; i++) lo = Math.min(lo, c.getX(i));
    assert(lo > 0.999, `an unshaded limb is not neutral (darkest ${lo.toFixed(3)})`);
    return `${c.count} vertices, all neutral white`;
  });

  check('shading: the creases are actually darker than the surfaces beside them', () => {
    // Baked occlusion that is everywhere 1.0 costs memory and does nothing,
    // and nothing downstream can tell. Each pair below is (crease, open
    // surface on the same mesh); the crease has to win by a real margin, not
    // by a rounding error. Boxes are in the BONE's own local frame: +Y runs
    // along the bone from its root and +Z is the front of the character.
    const u = unit('jedi');
    const g = (n) => u.rig.get(n).primary.geometry;
    const rows = [];
    const pairs = [
      // the armpit, against the middle of the ribcage's flank
      ['chest armpit', g('chest'), [0.10, 0.20, 0.15, 0.21, -0.06, 0.06], [0.10, 0.20, 0.02, 0.09, -0.06, 0.06]],
      // the root of the shoulder, against mid-humerus
      ['shoulder root', g('armL'), [-0.09, 0.09, 0, 0.03, -0.09, 0.09], [-0.09, 0.09, 0.12, 0.20, -0.09, 0.09]],
      // behind the knee, against the front of the same slice of shin
      ['knee back', g('shinL'), [-0.09, 0.09, 0, 0.04, -0.09, -0.02], [-0.09, 0.09, 0, 0.04, 0.02, 0.09]],
      // the thigh under the skirt, against the knee end of it
      ['thigh under skirt', g('thighL'), [-0.10, 0.10, 0, 0.06, -0.10, 0.10], [-0.10, 0.10, 0.36, 0.44, -0.10, 0.10]],
      // the neck down inside the collar, against the top of it
      ['neck in collar', g('neck'), [-0.07, 0.07, -0.05, 0.022, -0.07, 0.07], [-0.07, 0.07, 0.050, 0.080, -0.07, 0.07]],
      // the scalp under the hair, against the cheek
      ['scalp', u.rig.get('head').primary.geometry,
        [-0.08, 0.08, 0.13, 0.20, -0.10, 0.00], [-0.08, 0.08, 0.05, 0.09, 0.04, 0.10]],
    ];
    let worst = 1;
    for (const [label, geo, dark, light] of pairs) {
      const a = shadeIn(geo, dark), b = shadeIn(geo, light);
      assert(a && b, `${label}: one of the sample boxes caught no vertices`);
      const ratio = a.mean / b.mean;
      assert(ratio < 0.80, `${label} is only ${(ratio * 100).toFixed(0)}% of the open surface beside it (${a.n}/${b.n} verts)`);
      worst = Math.min(worst, ratio);
      rows.push(`${label} ${(ratio * 100).toFixed(0)}%`);
    }
    // and the darkest crease on the figure has to be a real drop, not a tint
    let darkest = 1, shaded = 0;
    u.rig.root.traverse((o) => {
      const c = o.isMesh && o.geometry && o.geometry.attributes.color;
      if (!c) return;
      let mn = 1;
      for (let i = 0; i < c.count; i++) mn = Math.min(mn, c.getX(i));
      if (mn < 0.995) shaded++;
      darkest = Math.min(darkest, mn);
    });
    assert(darkest < 0.45, `the darkest crease on the player is ${darkest.toFixed(2)} — that is a tint, not an occlusion`);
    assert(shaded >= 24, `only ${shaded} meshes on the player carry any occlusion at all`);
    return rows.join(' · ') + ` — ${shaded} meshes shaded, darkest ${darkest.toFixed(2)}`;
  });

  check('shading: a multi-swell limb still meets its caps at exactly r0 and r1', () => {
    // The deltoid and the bicep are two humps in one lathe now, and the cut
    // path rebuilds a stub from r0 and r1 alone. A hump that does not fall to
    // zero at both ends of the shaft — the obvious way to write one — puts the
    // stub's mouth several millimetres away from the piece that fell off it.
    const r0 = 0.052, r1 = 0.039, len = 0.285;
    const g = B.limbGeo(len, r0, r1, 16, false,
      { rings: 11, swells: [[0.15, 0.34, 0.155], [0.42, 0.085, 0.20]] });
    const p = g.attributes.position;
    let atBase = 0, atTip = 0, peak = 0, peakAt = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < 1e-6) atBase = Math.max(atBase, r);
      if (y > len - 1e-6) atTip = Math.max(atTip, r);
      if (r > peak) { peak = r; peakAt = y / len; }
    }
    near(atBase, r0, 1e-5, 'radius where the shaft meets its base cap');
    near(atTip, r1, 1e-5, 'radius where the shaft meets its tip cap');
    // and the swells have to have actually done something — a deltoid is a
    // third thicker than the shoulder joint under it
    assert(peak > r0 * 1.25, `the deltoid swell only reaches ${(peak * 1000).toFixed(1)}mm against a ${(r0 * 1000).toFixed(0)}mm joint`);
    assert(peakAt > 0.08 && peakAt < 0.30, `the deltoid peaks at ${(peakAt * 100).toFixed(0)}% of the humerus`);
    return `base ${(atBase * 1000).toFixed(2)}mm, tip ${(atTip * 1000).toFixed(2)}mm, peak ${(peak * 1000).toFixed(1)}mm at ${(peakAt * 100).toFixed(0)}%`;
  });

  check('shading: nothing is bolted onto the humerus where the deltoid should be', () => {
    // The deltoid used to be a squashed sphere parented to the arm bone and
    // dropped on top of the arm tube: 21% of its 168 triangles buried inside
    // the arm and the rest standing 13.6mm proud, so what the player saw was a
    // ball welded to a pipe with a hard intersection line right round the
    // shoulder. It is a swell in the arm's own lathe now. Garments — a sleeve
    // hem, a mantle — are allowed on the bone; a bare BODY mass is not.
    // Scoped to the flesh-and-cloth archetypes. A droid's shoulder bell is a
    // separate armour casting in the same painted plastoid as the strut under
    // it, and it is SUPPOSED to be a bolted-on mass — asserting otherwise there
    // would be a test that cries wolf, and those get muted.
    const rows = [];
    for (const name of ['jedi', 'trooper', 'acolyte']) {
      const u = unit(name);
      const bone = u.rig.get('armL');
      const arm = bone.primary;
      const armMat = arm.material;
      for (const o of bone.obj.children) {
        if (!o.isMesh || o === arm || o.userData.boneChild) continue;
        assert(o.material !== armMat,
          `${name} has a ${o.geometry.index ? o.geometry.index.count / 3 : 0}-triangle mass on the humerus in the arm's OWN material — that is a deltoid bolted on, not grown`);
      }
      // and the tube has to carry the mass itself
      const p = arm.geometry.attributes.position;
      let peak = 0, base = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getZ(i));
        peak = Math.max(peak, r);
        if (p.getY(i) < 1e-6) base = Math.max(base, r);
      }
      rows.push(`${name} ${(peak * 1000).toFixed(0)}mm peak / ${(base * 1000).toFixed(0)}mm at the joint`);
    }
    return rows.join('  ');
  });
}
