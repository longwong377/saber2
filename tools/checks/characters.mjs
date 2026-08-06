/**
 * Character checks — src/game/Bodies.js.
 *
 * Everything the player fights or plays as is generated in this one file, and
 * the failures it keeps producing are always one of four kinds:
 *
 *   · a proportion nobody measured (the player was 6.1 heads tall, with a head
 *     22.6cm across — a beach ball on a 1.69m body);
 *   · geometry authored inside other geometry, so it is never drawn at all;
 *   · a part whose local axes were guessed, so a 5.6cm-tall vent came out 5.6cm
 *     THICK and stood two inches out of the side of a helmet;
 *   · a tint multiplied by a texture whose mean albedo nobody looked up, so the
 *     boss rendered eleven times darker than it was written.
 *
 * Each of those is measurable off the built rig with no GPU, so each of them is
 * pinned here. The numbers below are measured, not chosen: where a bound looks
 * arbitrary the comment says what was measured and what it read as.
 */

import * as B from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';

const HUMANOIDS = ['jedi', 'b1', 'b2', 'trooper', 'acolyte'];
const ALL = [...HUMANOIDS, 'droideka', 'walker', 'beast'];

let THREE = null;
const BUILD = {
  jedi: (o) => B.buildJedi(o), b1: (o) => B.buildB1(o), b2: (o) => B.buildB2(o),
  trooper: (o) => B.buildTrooper(o), acolyte: (o) => B.buildAcolyte(o),
  droideka: (o) => B.buildDroideka(o), walker: (o) => B.buildWalker(o), beast: (o) => B.buildBeast(o),
};

/** One built, posed, matrix-updated archetype, cached — building is not cheap. */
const CACHE = new Map();
function unit(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const built = BUILD[name]({});
  const root = built.rig ? built.rig.root : built.group;
  if (built.rig && built.rig.get('thighL')) {
    // Stand it up the way the game does, so every measurement below is taken
    // off the pose the player actually sees rather than off the rest frame.
    const anim = new BipedAnimator(built.rig, { scale: built.rig.scale, hipHeight: 0.95 * built.rig.scale });
    anim.setFacing(0);
    const p = new THREE.Vector3(0, 0, 0), v = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60; i++) {
      anim.update(1 / 60, { position: p, facing: 0, velocity: v, grounded: true,
        groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
    }
    anim.swingArms(1 / 60, 0, 1);
    built.rig.updateMatrices();
  }
  root.updateMatrixWorld(true);
  const out = { built, root, rig: built.rig || null };
  CACHE.set(name, out);
  return out;
}

const box = (o) => new THREE.Box3().setFromObject(o);

/**
 * Rasterise a subtree's front silhouette into a fixed WORLD frame — 2.4m wide,
 * 2.4m tall, feet on the bottom edge — so two archetypes are compared the way
 * a player sees them, at the same metres per pixel. Normalising each figure to
 * its own bounding box instead would call a 1.9m droid and a 1.7m man
 * identical for being the same shape.
 */
function silhouette(root, W = 96, H = 96, frame = [-1.2, 1.2, 0, 2.4]) {
  const [u0, u1, v0, v1] = frame;
  const bits = new Uint8Array(W * H);
  const sx = (W - 1) / (u1 - u0), sy = (H - 1) / (v1 - v0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.visible === false) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
      const P = [a, b, c].map(q => [(q.x - u0) * sx, (v1 - q.y) * sy]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const d0 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(d0) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d0;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d0;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) bits[y * W + x] = 1;
      }
    }
  });
  return { bits, W, H };
}

function iou(a, b, y0 = 0, y1 = 1) {
  let inter = 0, uni = 0;
  const r0 = Math.floor(y0 * a.H), r1 = Math.floor(y1 * a.H);
  for (let y = r0; y < r1; y++) for (let x = 0; x < a.W; x++) {
    const i = y * a.W + x, p = a.bits[i], q = b.bits[i];
    if (p || q) uni++;
    if (p && q) inter++;
  }
  return uni ? inter / uni : 0;
}

/**
 * Fill ratio of a horizontal slice of a limb tube: enclosed area over the area
 * of its own bounding rectangle. A circle gives π/4 = 0.785, and so does an
 * ellipse however hard it is squashed — which is exactly why squashing the
 * mesh on Z never stopped a torso reading as a barrel. A rounded rectangle,
 * which is what a ribcage and a chest plate actually are, gives more.
 */
function sliceFill(m, yLocal, N = 512) {
  const g = m.geometry;
  const dir = new THREE.Vector3(), o = new THREE.Vector3(0, yLocal, 0), hit = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    dir.set(Math.sin(a), 0, Math.cos(a));
    if (!B.surfacePoint(g, dir, o, hit, true)) return null;
    pts.push([hit.x * m.scale.x, hit.z * m.scale.z]);
  }
  let area = 0, xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9;
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N];
    area += (p[0] * q[1] - q[0] * p[1]) / 2;
    xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
    zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]);
  }
  return { fill: Math.abs(area) / ((xmax - xmin) * (zmax - zmin)),
    w: xmax - xmin, d: zmax - zmin, front: zmax, back: -zmin };
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function run({ check, assert, near, THREE: T }) {
  THREE = T;

  check('characters: the figure is seven heads tall, not six', () => {
    // The single loudest proportion error a character can have, and this file
    // shipped it: the player measured 6.10 heads with a head 22.6cm wide on a
    // 1.69m body. An adult is 7.3-7.9 heads and head BREADTH is 15.5cm — 22.6
    // is a basketball, and no amount of face detail survives it.
    //
    // Measured on the head SHELL (chin to crown), not the whole head group,
    // so a hood, a crest fin or a braid cannot game the number.
    const rows = [];
    for (const name of ['jedi', 'trooper', 'acolyte']) {
      const u = unit(name);
      const H = box(u.root).getSize(new THREE.Vector3()).y;
      const head = u.rig.get('head');
      const shell = head.primary;
      shell.geometry.computeBoundingBox();
      const bb = shell.geometry.boundingBox;
      const hh = bb.max.y - bb.min.y, hw = bb.max.x - bb.min.x, hd = bb.max.z - bb.min.z;
      const heads = H / hh;
      assert(heads > 6.6 && heads < 8.6, `${name} is ${heads.toFixed(2)} heads tall (${H.toFixed(2)}m over a ${(hh * 100).toFixed(1)}cm head)`);
      // and a head is taller and deeper than it is wide. A helmet 22.4cm
      // across and 24.9 tall is the one proportion a helmet can never have,
      // and it is why the trooper read as a fridge with slots in it.
      assert(hw < hh * 0.98, `${name}'s head is ${(hw * 100).toFixed(1)}cm wide against ${(hh * 100).toFixed(1)}cm tall`);
      assert(hd > hw * 0.98, `${name}'s head is ${(hd * 100).toFixed(1)}cm deep against ${(hw * 100).toFixed(1)}cm wide`);
      rows.push(`${name} ${heads.toFixed(2)} heads, ${(hw * 100).toFixed(0)}×${(hh * 100).toFixed(0)}×${(hd * 100).toFixed(0)}cm`);
    }
    return rows.join(' · ');
  });

  check('characters: no torso is a body of revolution', () => {
    // A lathe is a circle in plan; squashing the mesh on Z makes it an ellipse.
    // Both fill exactly π/4 = 0.785 of their own bounding rectangle, and both
    // read as a barrel however carefully the radii are chosen. A ribcage, a
    // chest plate and a droid chassis are rounded rectangles: flat-ish front,
    // flatter back, corners at the flanks.
    const rows = [];
    for (const name of HUMANOIDS) {
      const u = unit(name);
      let worst = 1, worstAt = '';
      for (const bn of ['hips', 'spine', 'chest']) {
        const b = u.rig.get(bn);
        const s = sliceFill(b.primary, b.length * 0.5);
        assert(s, `${name} ${bn} has no closed section`);
        if (s.fill < worst) { worst = s.fill; worstAt = bn; }
      }
      assert(worst > 0.80, `${name} ${worstAt} fills ${worst.toFixed(3)} of its own box — an ellipse fills 0.785`);
      // and the back is flatter than the front, which is what a spine between
      // two erector masses looks like from above
      const ch = u.rig.get('chest');
      const s = sliceFill(ch.primary, ch.length * 0.5);
      assert(s.front / s.back > 1.04, `${name}'s chest is front-back symmetric (${(s.front / s.back).toFixed(2)})`);
      rows.push(`${name} ${worst.toFixed(3)} f/b ${(s.front / s.back).toFixed(2)}`);
    }
    return rows.join('  ');
  });

  check('characters: a shin carries a calf, not a cone', () => {
    // The lower leg is the largest single area on a running figure and it was
    // a smooth taper: from thirty metres the troopers' legs were two black
    // pipes with a white cuff. A real shin is flat down the tibia's front edge
    // and carries all of its mass behind, so it is DEEPER than it is wide and
    // the depth peaks about a third of the way up.
    const rows = [];
    for (const name of ['jedi', 'trooper', 'acolyte', 'b2']) {
      const u = unit(name);
      const sh = u.rig.get('shinL');
      const lo = sliceFill(sh.primary, sh.length * 0.30);
      const hi = sliceFill(sh.primary, sh.length * 0.78);
      assert(lo && hi, `${name} shin has no closed section`);
      assert(lo.d > lo.w * 1.03, `${name}'s shin is ${(lo.w * 100).toFixed(1)}cm wide and only ${(lo.d * 100).toFixed(1)}cm deep at the calf`);
      assert(lo.back / lo.front > 1.20, `${name}'s calf is not behind the tibia (back/front ${(lo.back / lo.front).toFixed(2)})`);
      assert(lo.d / hi.d > 1.35, `${name}'s shin does not taper to the ankle (${(lo.d / hi.d).toFixed(2)}×)`);
      rows.push(`${name} calf ${(lo.d / lo.w).toFixed(2)} deep/wide, ${(lo.back / lo.front).toFixed(2)} behind`);
    }
    return rows.join('  ');
  });

  check('characters: the shoulders are a slope, not a plateau with a neck in it', () => {
    // The chest lathe ends in a flat disc and the neck comes out of the middle
    // of it. With nothing bridging the two there is no line from the ear to
    // the point of the shoulder — the first edge a human silhouette is read
    // by — and the head looks bolted on however well the collar is sized.
    // Measured as: how much of the horizontal gap between the neck and the
    // acromion is filled at trapezius height.
    const rows = [];
    for (const name of ['jedi', 'trooper']) {
      const u = unit(name);
      const cb = u.rig.get('chest'), cl = u.rig.get('clavL');
      const tip = new THREE.Vector3(0, cl.length, 0).applyQuaternion(cl.restQuat).add(cl.offset);
      // widest solid x at the trapezius height, over everything on the chest bone
      const y = tip.y - 0.015 * u.rig.scale;
      let widest = 0;
      for (const o of cb.obj.children) {
        if (!o.isMesh) continue;
        o.updateMatrixWorld(true);
        const g = o.geometry, p = g.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrix);
          if (Math.abs(v.y - y) < 0.018 * u.rig.scale) widest = Math.max(widest, Math.abs(v.x));
        }
      }
      const frac = widest / tip.x;
      assert(frac > 0.62, `${name} carries only ${(frac * 100).toFixed(0)}% of the way to the acromion at trapezius height`);
      rows.push(`${name} ${(frac * 100).toFixed(0)}% to the acromion`);
    }
    return rows.join('  ');
  });

  check('characters: every archetype is a different shape at thirty metres', () => {
    // Rasterised into ONE world frame — same metres per pixel, feet on the
    // floor — because that is how a player meets them. The whole-body overlap
    // between two humanoids can never go very low (they share a skeleton), so
    // the number that matters is the head-and-shoulder band: the helmet, the
    // hood, the bells and the mantle are what actually get read first, and
    // before this pass the Jedi and the trooper were 84% the same figure with
    // a different paint job.
    const sils = {};
    for (const n of HUMANOIDS) {
      const u = unit(n);
      const b = box(u.root);
      u.root.position.y -= b.min.y;
      u.root.updateMatrixWorld(true);
      sils[n] = silhouette(u.root);
      u.root.position.y += b.min.y;
      u.root.updateMatrixWorld(true);
    }
    let worst = 0, worstPair = '', worstBand = 0, bandPair = '';
    for (const a of HUMANOIDS) for (const b of HUMANOIDS) {
      if (a >= b) continue;
      const full = iou(sils[a], sils[b]);
      // 1.35m-1.95m off the floor: head, helmet, shoulders, pauldrons
      const band = iou(sils[a], sils[b], 0.1875, 0.4375);
      if (full > worst) { worst = full; worstPair = `${a}/${b}`; }
      if (band > worstBand) { worstBand = band; bandPair = `${a}/${b}`; }
    }
    assert(worst < 0.86, `${worstPair} share ${(worst * 100).toFixed(0)}% of one silhouette`);
    assert(worstBand < 0.78, `${bandPair} have ${(worstBand * 100).toFixed(0)}% the same head and shoulders`);
    // and they must not all be the same size either
    const areas = HUMANOIDS.map(n => sils[n].bits.reduce((s, v) => s + v, 0));
    assert(Math.max(...areas) / Math.min(...areas) > 2.2,
      `every archetype covers the same area (${Math.min(...areas)}..${Math.max(...areas)} px)`);
    return `worst overlap ${worstPair} ${worst.toFixed(2)}, worst head+shoulders ${bandPair} ${worstBand.toFixed(2)}, area spread ${(Math.max(...areas) / Math.min(...areas)).toFixed(1)}×`;
  });

  check('characters: nothing on a head stands off it like a bolted-on slab', () => {
    // Kit.aim() puts a part's local +Y along the surface normal, so a panel
    // authored as (width, height, thickness) comes out (width, THICKNESS,
    // height): a vent 5.6cm tall became 5.6cm deep and stood two inches out of
    // the side of a trooper's helmet, and the acolyte wore a 4.2cm gold brick
    // where its mouth should be. Kit.face() is the frame panels actually want.
    //
    // Measured as: nothing on the head may reach further from the head's own
    // axis than the shell does, by more than a plausible fitting.
    const rows = [];
    for (const name of HUMANOIDS) {
      const u = unit(name);
      const head = u.rig.get('head');
      const shell = head.primary;
      shell.geometry.computeBoundingBox();
      const sb = shell.geometry.boundingBox;
      const shellSpan = sb.getSize(new THREE.Vector3()).length();
      let worst = 0, worstN = 0;
      for (const o of head.obj.children) {
        if (!o.isMesh || o === shell) continue;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
        // Garments are allowed to be bigger than the head — a hood and a hair
        // cap are supposed to sit outside the skull. This is about DETAIL:
        // vents, visors, lenses, crests, studs.
        if (b.getSize(new THREE.Vector3()).length() > shellSpan * 0.55) continue;
        // sideways only, since fins and crests are legitimately tall and long
        const out = Math.max(b.max.x - sb.max.x, sb.min.x - b.min.x);
        if (out > worst) { worst = out; worstN = o.geometry.attributes.position.count; }
      }
      const S = u.rig.scale;
      assert(worst < 0.022 * S,
        `${name} has a ${worstN}-vertex part standing ${(worst * 1000).toFixed(0)}mm out past the side of its own head`);
      rows.push(`${name} ${(worst * 1000).toFixed(0)}mm`);
    }
    return rows.join('  ');
  });

  check('characters: every body material lands on the colour it was named', () => {
    // MeshStandardMaterial multiplies `color` by `map`, so the number typed is
    // never the colour rendered — it is that colour times the bake's mean
    // albedo. The rock bake means 0.110 because rock is dark, and the boss's
    // carapace, authored 0x8f7a63, was rendering at a linear 0.030/0.016/0.008:
    // eleven times darker than written. Every helper now records what it was
    // aiming at and which bake it is multiplying, so the gap is a number.
    //
    // The organic and metal families are corrected to land on 1.00. The armour
    // family is deliberately left raw — those bakes ARE the paint and every
    // tint in the file was picked looking at the result — so it is pinned at
    // its own known factor instead of being quietly allowed to drift.
    const seen = new Map();
    for (const name of ALL) {
      const u = unit(name);
      u.root.traverse((o) => {
        const m = o.material;
        if (!o.isMesh || !m || !m.color || !m.userData.mapMean || seen.has(m)) return;
        seen.set(m, name);
      });
    }
    assert(seen.size >= 25, `only ${seen.size} mapped materials across ${ALL.length} archetypes`);
    let worstLow = 1, worstAt = '', bright = 0;
    const rows = [];
    for (const [m, who] of seen) {
      const mean = m.userData.mapMean, want = m.userData.authored;
      const eff = [m.color.r * mean[0], m.color.g * mean[1], m.color.b * mean[2]];
      const ratio = lum(eff) / Math.max(1e-6, lum(want));
      assert(isFinite(ratio) && ratio > 0, `${who}: a material has a non-finite tint`);
      // The armour bake is 0.65 of what you type and the file knows it; below
      // 0.55 something is being multiplied by a bake nobody looked up.
      assert(ratio > 0.55, `${who}: a material renders ${(1 / ratio).toFixed(1)}× darker than the ${want.map(v => v.toFixed(2)).join('/')} it was authored as`);
      assert(ratio < 1.02, `${who}: a material renders brighter than authored (${ratio.toFixed(2)}×)`);
      if (ratio < worstLow) { worstLow = ratio; worstAt = who; }
      if (ratio > 0.98) bright++;
    }
    rows.push(`${seen.size} mapped materials, ${bright} corrected to 1.00, darkest ${worstAt} ${worstLow.toFixed(2)}×`);
    // and nothing on a character may be an untextured plastic sheet: skin was
    // the last one, on the face, the neck and both hands of the player
    let bare = 0, bareTotal = 0;
    for (const name of ALL) {
      const u = unit(name);
      const mats = new Set();
      u.root.traverse((o) => { if (o.isMesh && o.material && o.material.color) mats.add(o.material); });
      for (const m of mats) {
        bareTotal++;
        // Emissive lenses are legitimately flat — they carry no diffuse
        // detail at all. Everything with a real surface needs a map. NB the
        // test: emissiveIntensity defaults to 1 on every MeshStandardMaterial,
        // so testing it excuses the entire cast; it is the emissive COLOUR
        // that says a material is a light source.
        const glows = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05;
        if (!m.map && !glows && m.userData.mapMean === undefined) bare++;
      }
    }
    assert(bare <= 4, `${bare} of ${bareTotal} character materials are untextured flat colour`);
    return rows[0] + `, ${bare}/${bareTotal} deliberately flat`;
  });

  check('characters: a cross-section reshape keeps the surface smooth', () => {
    // The torso sections are applied by deforming the lathe after the fact, and
    // the obvious way to fix the normals afterwards — computeVertexNormals() —
    // averages per index. The lathe duplicates its seam column, so each seam
    // vertex would only see the faces on its own side: a hard lighting crease
    // running the full length of every torso, arm and leg. The normals are
    // transported through the deformation analytically instead, so the seam
    // pair must still agree to the last bit and every normal must stay unit.
    const u = unit('jedi');
    const g = u.rig.get('chest').primary.geometry;
    const p = g.attributes.position, n = g.attributes.normal;
    let worstLen = 0, seamPairs = 0, worstSeam = 0;
    const byKey = new Map();
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      worstLen = Math.max(worstLen, Math.abs(l - 1));
      // The seam duplicates: same position, two entries. Skip the poles — the
      // lathe collapses a whole ring onto the axis there and those normals fan
      // out by design.
      if (Math.hypot(p.getX(i), p.getZ(i)) < 1e-4) continue;
      // |0 rather than toFixed: the lathe's seam column lands on x = -2.4e-16,
      // and "-0.000000" is not the same string as "0.000000".
      const q = (v) => (Math.round(v * 1e6) | 0);
      const key = `${q(p.getX(i))},${q(p.getY(i))},${q(p.getZ(i))}`;
      if (byKey.has(key)) {
        const j = byKey.get(key);
        const d = Math.hypot(n.getX(i) - n.getX(j), n.getY(i) - n.getY(j), n.getZ(i) - n.getZ(j));
        worstSeam = Math.max(worstSeam, d);
        seamPairs++;
      } else byKey.set(key, i);
    }
    assert(worstLen < 1e-5, `a reshaped normal is ${(1 + worstLen).toFixed(4)} long`);
    assert(seamPairs >= 4, `only ${seamPairs} coincident vertices — the seam test proved nothing`);
    assert(worstSeam < 1e-5, `the lathe seam disagrees by ${worstSeam.toExponential(1)} — that is a crease down the front of the torso`);
    // and the deformation has to have actually done something
    const before = B.limbGeo(0.2, 0.15, 0.13, 14, true, { rings: 4 });
    const after = B.limbGeo(0.2, 0.15, 0.13, 14, true, { rings: 4, section: (th) => 1 + 0.15 * Math.cos(th) });
    before.computeBoundingBox(); after.computeBoundingBox();
    const dz = after.boundingBox.max.z - before.boundingBox.max.z;
    assert(dz > 0.015, `the section did not move the surface (${dz.toFixed(4)}m)`);
    return `${seamPairs} seam pairs agree to ${worstSeam.toExponential(1)}, normals unit to ${worstLen.toExponential(1)}`;
  });

  check('characters: a raycast onto a shell finds the OUTSIDE of it', () => {
    // Every feature in this file is seated by firing a ray from inside a head
    // and taking where it leaves. A head is a union of overlapping ellipsoids
    // and boxes, and a ray leaving a point inside three of them exits the
    // smallest one first — so the nearest hit is not the surface, it is a wall
    // in the middle of the skull. Probed that way the player's eyes, brows and
    // lips all seated on the inside of the nose, five centimetres back.
    const a = new THREE.SphereGeometry(0.10, 16, 12);
    const b = new THREE.SphereGeometry(0.04, 12, 8);
    b.translate(0, 0, 0.05);
    const merged = new THREE.BufferGeometry();
    // two nested-ish shells in one buffer, the way assemble() leaves a head
    const pa = a.attributes.position, pb = b.attributes.position;
    const pos = new Float32Array((pa.count + pb.count) * 3);
    pos.set(pa.array, 0); pos.set(pb.array, pa.count * 3);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ia = a.index, ib = b.index;
    const idx = new Uint32Array(ia.count + ib.count);
    for (let i = 0; i < ia.count; i++) idx[i] = ia.getX(i);
    for (let i = 0; i < ib.count; i++) idx[ia.count + i] = ib.getX(i) + pa.count;
    merged.setIndex(new THREE.BufferAttribute(idx, 1));

    const dir = new THREE.Vector3(0, 0, 1);
    const near = B.surfacePoint(merged, dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(), false);
    const far = B.surfacePoint(merged, dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(), true);
    assert(near && far, 'the probe missed a shell it starts inside');
    // the small sphere's far wall is at z = 0.09, the big one's at 0.10
    assert(Math.abs(far.z - 0.10) < 0.004, `the outward probe stopped at z=${far.z.toFixed(4)}, not the outer shell at 0.100`);
    assert(far.z > near.z + 0.005, `both probes returned the same point (${near.z.toFixed(4)} / ${far.z.toFixed(4)})`);
    return `union of two shells: nearest exit z=${near.z.toFixed(3)}, outermost z=${far.z.toFixed(3)}`;
  });

  check('characters: no archetype has quietly doubled in cost', () => {
    // Twenty of these are on screen at once and each one costs a draw call per
    // material per bone, doubled by the shadow pass. The budget is not a taste
    // question — the arena smoke test runs at 472 draw calls with one enemy up.
    const rows = [];
    let tris = 0, meshes = 0;
    for (const name of ALL) {
      const u = unit(name);
      let t = 0, m = 0;
      u.root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        m++;
        const g = o.geometry;
        t += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      });
      assert(t < 13000, `${name} is ${Math.round(t)} triangles`);
      assert(m < 76, `${name} is ${m} meshes — that is ${m * 2} draw calls with shadows`);
      tris += t; meshes += m;
      rows.push(`${name} ${Math.round(t)}/${m}`);
    }
    assert(tris < 72000, `${ALL.length} archetypes cost ${Math.round(tris)} triangles between them`);
    return rows.join(' ') + ` — ${Math.round(tris)} tris, ${meshes} meshes total`;
  });

  check('characters: hands are hands, at the scale a hand is', () => {
    // The player's own gloves are the largest thing in a first-person frame and
    // both of them are one merged geometry, so nothing downstream can tell how
    // big they were built. A palm is 8.6cm across and 7.4 from the wrist crease
    // to the knuckles on a 1.78m figure; the fingers must actually curl, or the
    // hand is a paddle wrapped round a hilt.
    const flat = B.buildHand('L', 1, { curl: 0 });
    const curled = B.buildHand('L', 1, { curl: 1 });
    flat.computeBoundingBox(); curled.computeBoundingBox();
    const f = flat.boundingBox.getSize(new THREE.Vector3());
    const c = curled.boundingBox.getSize(new THREE.Vector3());
    // width is measured on the CURLED hand: splayed, the thumb is abducted
    // 38 degrees off the palm and adds three centimetres that no hand holding
    // a hilt ever shows.
    near(c.x, 0.100, 0.022, 'hand width');
    assert(f.y > 0.16 && f.y < 0.22, `an open hand is ${(f.y * 100).toFixed(1)}cm long`);
    assert(c.y < f.y * 0.78, `curling the fingers barely shortened the hand (${(c.y / f.y).toFixed(2)})`);
    assert(c.z > f.z * 1.5, `curled fingers did not come round the palm (${(c.z / f.z).toFixed(2)}× deep)`);
    const tris = curled.index.count / 3;
    assert(tris < 900, `a hand is ${tris} triangles`);
    return `open ${(f.x * 100).toFixed(1)}×${(f.y * 100).toFixed(1)}cm, curled to ${(c.y * 100).toFixed(1)}cm and ${(c.z * 100).toFixed(1)}cm deep, ${tris} tris`;
  });
}
