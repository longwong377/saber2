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
import { Enemy } from '../../src/game/Enemy.js';
import { clocked } from './_shared.mjs';
import { functionBody } from './_source.mjs';

/** The five things an Enemy touches while it is being posed, and nothing else. */
function gunWorld() {
  return {
    scene: new THREE.Scene(), settings: {}, difficulty: null,
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, surfaceAt: () => 'sand' },
    physics: { add() {}, remove() {}, bodies: [], staticBoxes: [], raycast: () => null,
      addJoint() {}, removeJoint() {} },
    particles: null, bolts: null, time: 0, enemies: [], players: [],
    notify() {}, report() {}, addHitstop() {},
  };
}

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

/* ══════════════════════════════════════════════════════════════════════ */
/*  eyes                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * EVERY TRIANGLE IN A BUILT BODY, IN WORLD SPACE, SPLIT BY WHAT IT IS.
 *
 * `role: 'eye'` is written by `eyeMat` in Bodies.js and by nothing else, so
 * this reads the body's own declaration rather than guessing from a colour or
 * from "is it emissive". The 2-1B's other lit material paints a readout on
 * each forearm and one on the chest, at the same hue and intensity as the
 * receptor band on its face, and an instrument is not a face.
 */
function bodyTris(root) {
  root.updateMatrixWorld(true);
  const eyes = [], all = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const role = o.material?.userData?.role;
    const hidden = !!o.material?.userData?.hidden;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const t = [a.clone(), b.clone(), c.clone()];
      all.push(t);
      if (role === 'eye') eyes.push({ t, hidden });
    }
  });
  return { eyes, all };
}

/**
 * ONE EYE AT A TIME, and the split is over shared vertices.
 *
 * The Kit merges per material, so a body's eyes arrive as ONE geometry with
 * two, four or six balls in it, and a mean taken over that geometry is exactly
 * the measurement that would have missed this: the nexu's upper pair was 97%
 * of an eye radius proud and its lower pair was 108% INSIDE the skull, and the
 * average of the four is a healthy-looking number for an animal with two eyes.
 * Every ball is asked about on its own.
 */
function eyeballs(eyes) {
  const key = (v) => `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
  const up = eyes.map((_, i) => i);
  const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const seen = new Map();
  eyes.forEach((e, i) => {
    for (const v of e.t) {
      const k = key(v);
      if (seen.has(k)) { const x = find(seen.get(k)), y = find(i); if (x !== y) up[x] = y; } else seen.set(k, i);
    }
  });
  const g = new Map();
  eyes.forEach((e, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(e); });
  return [...g.values()];
}

/**
 * WHAT FRACTION OF ONE EYE IS NOT LOOKING AT ITS OWN HEAD.
 *
 * A ray along each triangle's OWN normal against every other triangle in the
 * body. The normal and not a camera, because an eye is read from wherever the
 * player happens to be standing and a fixed camera answers a question about
 * one pose; and every other triangle rather than just the skull, because the
 * thing that buries an eye is as often a tusk, a horn or the pupil in front of
 * it as it is the cranium.
 *
 * The back half of a ball on a surface is always obstructed — its normals
 * point into whatever it is sitting on — so a perfectly seated eye scores
 * about a quarter and never a half. The bound below is read against that.
 */
function clearFraction(cluster, all, eps) {
  const ray = new THREE.Ray(), tri = new THREE.Triangle();
  const hit = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
  const own = new Set(cluster.map((e) => e.t));
  let clear = 0;
  for (const e of cluster) {
    tri.set(e.t[0], e.t[1], e.t[2]);
    tri.getNormal(n);
    if (n.lengthSq() < 0.5) continue;                 // a degenerate sliver has no direction
    mid.copy(e.t[0]).add(e.t[1]).add(e.t[2]).multiplyScalar(1 / 3);
    ray.origin.copy(mid).addScaledVector(n, eps);
    ray.direction.copy(n);
    let blocked = false;
    for (const t of all) {
      if (own.has(t)) continue;
      if (ray.intersectTriangle(t[0], t[1], t[2], false, hit)) { blocked = true; break; }
    }
    if (!blocked) clear++;
  }
  return { clear, total: cluster.length };
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export async function run({ check, assert, near, THREE: T }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
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

  /**
   * ── THE HUMANOID ROSTER, MEASURED THE WAY THE MENAGERIE WAS ──────────
   *
   * The check above is five archetypes at LOD 0. `tools/_roster.mjs` measures
   * all thirty-one at LOD 1 — past the distance cull, which is where the
   * complaint lives — and what it found is that the "sphere with some legs"
   * pass fixed the creatures and the machines and never touched the people:
   *
   *     humanoids  103 of 171 pairs over 0.50 flank IoU, two of them 1.000
   *     machines     0 of  21, worst 0.243
   *     creatures    0 of  10, worst 0.415
   *
   * WHY 0.50 IS THE MACHINES' NUMBER AND CANNOT BE THE HUMANOIDS'. A droideka
   * and a walker differ in leg count; a reek and a nexu differ in body plan.
   * Nineteen humanoids share ONE skeleton, one standing height and one gait,
   * and eleven of them share a scale with another to within 5%. Measured over
   * all 171 pairs after this pass, the whole-body flank minimum is 0.254 — and
   * that is between the two most extreme bodies the roster owns, a bare-strut
   * training droid 41 cm across and a 1.92 m clone commander with a comms
   * antenna. Two 1.7 m bipeds standing the same way cannot be made to overlap
   * less than about a quarter by anything short of not being bipeds.
   *
   * So the bound below is 0.89 rather than 0.50, it is a RATCHET rather than a
   * taste, and it is written against a measurement: the worst pair here was
   * 1.000 — twice, two builders called with identical arguments — and is 0.871.
   * Tighten it whenever the measurement allows; the one thing not to do is
   * loosen it to meet a regression.
   *
   * WHAT THE CHECK BUILDS. `Bodies.BODY_KITS` is the archetype → kit table and
   * this walks it, so a kit that stops resolving fails here. It does NOT build
   * through `Enemy`, and the reason is written at BODY_KITS: `Enemy._build`
   * does not yet thread the archetype key into the builder, so the shipped
   * roster still renders the un-kitted bodies. `tools/_roster.mjs --wired`
   * prints both numbers side by side. Measuring the builders is measuring what
   * this file owns and can guarantee; claiming the roster wears them would be
   * measuring something nobody has built yet.
   */
  const KITTED = {
    trooper: (o) => B.buildTrooper(o), sniper: (o) => B.buildTrooper(o),
    heavy: (o) => B.buildTrooper(o), jet: (o) => B.buildTrooper(o),
    arc: (o) => B.buildTrooper(o), officer: (o) => B.buildTrooper(o),
    jedi: (o) => B.buildJedi(o), sentinel: (o) => B.buildJedi(o),
    guardian: (o) => B.buildJedi(o), master: (o) => B.buildJedi(o),
    b1: (o) => B.buildB1(o), rocket: (o) => B.buildB1(o),
    bx: (o) => B.buildB1(o), dummy: (o) => B.buildB1(o),
    acolyte: (o) => B.buildAcolyte(o), sparring: (o) => B.buildAcolyte(o),
    b2: (o) => B.buildB2(o), magna: (o) => B.buildBodyguard(o),
    bodyguard: (o) => B.buildBodyguard(o),
    /* The roster's first winged body, and the one the two rules below were
     * about when it was authored: it keeps 31 of 36 meshes past thirty metres
     * (the ceiling is 32, and marking its lenses and mandibles as outline as
     * well measured 34) and its worst pair is 0.540 against the training
     * droid, the lowest on this table but one. Both are consequences of the
     * wings, which is the argument for putting them on `wing` bones and
     * tagging them `silhouette`: a Geonosian at thirty metres with its wings
     * culled is a thin man. */
    geonosian: (o) => B.buildGeonosian(o),
  };
  /** The archetype's own scale, so a 1.06 heavy is not normalised into a 1.00. */
  const KIT_SCALE = {
    trooper: 1.0, sniper: 1.0, heavy: 1.06, jet: 0.98, arc: 1.02, officer: 1.03,
    jedi: 1.0, sentinel: 1.02, guardian: 1.05, master: 1.03,
    b1: 1.02, rocket: 1.04, bx: 1.06, dummy: 1.02,
    acolyte: 1.04, sparring: 1.04, b2: 1.18, magna: 1.18, bodyguard: 1.3,
    geonosian: 0.928,
  };

  /**
   * One kitted body, posed, with everything the distance cull would hide
   * actually hidden.
   *
   * The cull rule is `Enemy._collectLodParts` + `_applyLod`: keep one primary
   * per bone, keep anything tagged `userData.silhouette`, hide the rest. This
   * applies the same rule to a bare rig, because a check cannot construct an
   * `Enemy` without a World and a physics step; `tools/_roster.mjs` is the
   * probe that drives the real one.
   *
   * WHAT THIS SEES THAT THE PROBE DOES NOT, stated rather than glossed: no
   * LOADOUT. `Enemy._build` puts a blaster in the hand and a blade in the fist,
   * and neither is in `BODY_KITS`. So the two disagree in BOTH directions and
   * it is worth knowing which way: where the loadout differs this is stricter
   * (an armed B1 against an unarmed training droid measures 0.641 with the
   * carbine and worse without it), and where the loadout is identical it is
   * looser (a trooper and a marksman both carry a DC-15, which is shared area:
   * 0.871 here, 0.895 with the rifles on). Bodies are what this file makes, so
   * bodies are what it is held to; the probe is where the whole spawned enemy
   * is measured.
   */
  const LOD_CACHE = new Map();
  function lodBody(name) {
    if (LOD_CACHE.has(name)) return LOD_CACHE.get(name);
    const opts = { scale: KIT_SCALE[name], ...(B.bodyOptsFor(name) || {}) };
    const built = KITTED[name](opts);
    const rig = built.rig;
    const anim = new BipedAnimator(rig, { scale: rig.scale, hipHeight: 0.95 * rig.scale });
    /* FACING +X, so a raster that looks down -Z sees the FLANK.
     *
     * This is not a detail. The check above rasterises the front, where a body
     * is read by its WIDTH; a pack, a cape, a kama, a rangefinder and a slung
     * weapon are all depth, and head-on they are edge-on. Measured with the
     * figure left facing +Z, a Clone Commander with a 52 cm antenna, a comms
     * pack and a half-cape came out 0.915 against an ARC — the same number it
     * had before any of them existed, because the raster could not see one of
     * them. The flank is also the view a firing line is met in.
     */
    const FACE = Math.PI / 2;
    anim.setFacing(FACE);
    const p = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < 60; i++) {
      anim.update(1 / 60, { position: p, facing: FACE, velocity: v, grounded: true,
        groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
    }
    anim.swingArms(1 / 60, 0, 1);
    rig.updateMatrices();
    rig.root.updateMatrixWorld(true);
    const keep = new Set();
    for (const b of rig.list) if (b.primary) keep.add(b.primary);
    let kept = 0, total = 0;
    rig.root.traverse((o) => {
      if (!o.isMesh) return;
      total++;
      o.visible = keep.has(o) || !!o.userData.silhouette;
      if (o.visible) kept++;
    });
    const out = { built, rig, root: rig.root, kept, total };
    LOD_CACHE.set(name, out);
    return out;
  }

  check('characters: every humanoid archetype has a kit, and it is the roster’s', async () => {
    // The failure this forbids is SILENCE: a nineteenth humanoid added to the
    // roster with no row in BODY_KITS looks exactly like an archetype that
    // deliberately wears nothing, and the last time that happened three
    // archetypes went a whole session without a body of their own.
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');       // the Command units and the IG general
    const missing = [], unknown = [];
    for (const [key, A] of Object.entries(ARCHETYPES)) {
      // Enemy._build's own rule for what is a humanoid, not a copy of it.
      const humanoid = !A.custom || A.custom === 'humanoid';
      if (!humanoid) continue;
      if (!B.bodyOptsFor(key)) missing.push(key);
    }
    for (const key of Object.keys(B.BODY_KITS)) if (!ARCHETYPES[key]) unknown.push(key);
    assert(!missing.length, `${missing.join(', ')} on the roster with no row in BODY_KITS`);
    assert(!unknown.length, `BODY_KITS names ${unknown.join(', ')}, which no archetype claims`);
    // …and every kit named has to resolve. A typo in a kit name silently falls
    // back to the line trooper, which is the defect wearing a new coat.
    const tables = { kit: [B.TROOPER_KITS, B.B1_KITS, B.ACOLYTE_KITS, B.BODYGUARD_KITS],
                     rank: [B.JEDI_RANKS] };
    for (const [key, o] of Object.entries(B.BODY_KITS)) {
      for (const field of ['kit', 'rank']) {
        if (o[field] === undefined) continue;
        assert(tables[field].some((t) => o[field] in t),
          `${key} asks for ${field} '${o[field]}' and no table has one`);
      }
    }
    return `${Object.keys(B.BODY_KITS).length} humanoid archetypes outfitted, every kit resolves`;
  });

  check('characters: a humanoid is more than nineteen tubes past thirty metres', () => {
    // THE MEASURED DEFECT. `_applyLod` keeps one primary per bone plus anything
    // tagged `userData.silhouette`, and `markSilhouette` was called three times
    // in the whole codebase — all three inside the creature builder. So every
    // one of the nineteen humanoids kept exactly nineteen meshes at LOD 1, the
    // same nineteen tubes, while a creature kept 27 to 31 of 31 to 37: no
    // cuirass, no tabard, no backpack, no hood, no robe hem and no weapon.
    //
    // The ceiling is the other half of it. This is a per-body draw call at a
    // range where twenty bodies are on screen, so "keep everything" is not the
    // answer either; 32 is above the busiest creature and below twice what a
    // humanoid used to cost.
    const rows = [];
    let worstLow = 99, lowAt = '', worstHigh = 0, highAt = '';
    for (const name of Object.keys(KITTED)) {
      const u = lodBody(name);
      if (u.kept < worstLow) { worstLow = u.kept; lowAt = name; }
      if (u.kept > worstHigh) { worstHigh = u.kept; highAt = name; }
      rows.push(`${name} ${u.kept}/${u.total}`);
    }
    assert(worstLow > 19, `${lowAt} keeps ${worstLow} meshes at LOD 1 — the bare limb tubes and nothing else`);
    assert(worstHigh <= 32, `${highAt} keeps ${worstHigh} meshes at LOD 1, which is ${worstHigh * 2} draw calls with shadows`);
    return `${worstLow} (${lowAt}) … ${worstHigh} (${highAt}) meshes kept · ` + rows.join(' ');
  });

  check('characters: no two humanoid kits are the same body at thirty metres', () => {
    // Rasterised into ONE absolute 2.6 m frame at 1.3 cm per pixel, feet on the
    // floor, at each archetype's own scale — see the long note above for why
    // the bound is 0.90 and not the creatures' 0.50, and for the measurement
    // that says 0.50 is not reachable by nineteen bodies on one skeleton.
    const FR = [-1.3, 1.3, 0, 2.6], N = 200;
    const names = Object.keys(KITTED);
    const sils = {};
    for (const n of names) {
      const u = lodBody(n);
      const b = box(u.root);
      u.root.position.y -= b.min.y;
      u.root.updateMatrixWorld(true);
      sils[n] = silhouette(u.root, N, N, FR);
      u.root.position.y += b.min.y;
      u.root.updateMatrixWorld(true);
    }
    let worst = 0, worstPair = '', over = 0, pairs = 0, min = 1;
    for (const a of names) for (const b2 of names) {
      if (a >= b2) continue;
      pairs++;
      const v = iou(sils[a], sils[b2]);
      if (v > worst) { worst = v; worstPair = `${a}/${b2}`; }
      if (v < min) min = v;
      if (v > 0.50) over++;
    }
    assert(worst < 0.89, `${worstPair} share ${(worst * 100).toFixed(1)}% of one silhouette at LOD 1`);
    // …and no two are byte-identical, which is what the trooper/marksman and
    // the acolyte/sparring pairs measured before there were kits at all.
    assert(worst < 0.99, `${worstPair} is one body built twice`);
    return `worst ${worstPair} ${worst.toFixed(3)}, ${over}/${pairs} over 0.50, floor ${min.toFixed(3)}`;
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

  check('characters: and the twelve companion bodies are under the same roof', async () => {
    /**
     * `ALL` IS A TYPED LIST OF EIGHT BUILDERS, AND TWELVE BODIES WALKED ROUND
     * THE OUTSIDE OF IT.
     *
     * The cost check above is the game's only triangle bound and it enumerates
     * its subjects by hand: five humanoids plus the droideka, the walker and
     * the beast. Every companion kind is built by a different door —
     * `COMPANION_KINDS[*].archetype` into `ARCHETYPES`, most of them through
     * `buildQuadruped` off a CREATURE_PLANS row — so not one of them was
     * weighed. Measured when this was written: the wookiee at 13 732 triangles
     * was over the shipped cap and nothing in the tree said so.
     *
     * AND THE BOUND IS THE SAME 13 000, WHICH IS THE ARGUABLE PART. The cap
     * above is justified by "twenty of these are on screen at once", and there
     * is exactly ONE companion. That reads like a licence to spend more, and it
     * is the opposite: COMPANIONS.md's own honest-doubt section records that
     * every rung of the LOD ladder keys on camera distance — the band select,
     * the merged skin at 62 m, the cohort past L3_AT, `clothOn` against a
     * clothCut of 30 — and a companion is inside 30 m of somebody FOREVER. It
     * is permanently LOD 0: full skeletal solve every frame, every decoration
     * mesh drawn, never merged, never cohorted. A trooper at 13 000 is 13 000
     * that the ladder takes away as he walks off; a companion at 13 000 is
     * 13 000 in every frame of the run, in exactly the frames that are already
     * the worst ones. The same number is the right number, and it is a ceiling
     * rather than a target.
     *
     * DRIVEN FROM `COMPANION_KINDS` AND NOT FROM A LIST, which is the whole
     * reason the defect existed: the kind that lands tomorrow is weighed the
     * day it lands.
     */
    const { COMPANION_KINDS } = await import('../../src/game/CompanionKinds.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    const rows = [], over = [];
    let tris = 0;
    for (const id of Object.keys(COMPANION_KINDS)) {
      const type = COMPANION_KINDS[id].archetype ?? id;
      const A = ARCHETYPES[type];
      assert(A, `${id} names archetype "${type}" and nothing registers it`);
      assert(typeof A.build === 'function', `${type} has no builder to weigh`);
      const built = A.build({ scale: A.scale ?? 1 });
      const root = built?.rig?.root ?? built?.group;
      assert(root, `${type} built neither a rig nor a group`);
      root.updateMatrixWorld?.(true);
      let t = 0, m = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        m++;
        const g = o.geometry;
        t += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      });
      if (t >= 13000) over.push(`${id} ${Math.round(t)}`);
      if (m >= 76) over.push(`${id} ${m} meshes`);
      tris += t;
      rows.push(`${id} ${Math.round(t)}/${m}`);
    }
    assert(rows.length >= 12, `only ${rows.length} companion kinds were weighed of twelve`);
    assert(!over.length,
      `${over.join(', ')} — over the 13 000 triangle / 76 mesh cap the roster has kept for a body `
      + 'that at least gets LOD relief, on a body that never leaves LOD 0');
    return `${rows.length} companion bodies, ${Math.round(tris)} triangles between them: ${rows.join(' ')}`;
  });

  check('characters: every companion and every creature has an eye you can see', async () => {
    /**
     * THREE OF THE PLAYER'S TWELVE COMPANIONS RENDERED NO EYE AT ALL.
     *
     * Not a small eye — no eye. The sphere was inside the cranium, every
     * triangle of it facing another triangle of the same animal's head.
     * Measured on the tree this check landed on, casting a ray along each eye
     * triangle's own normal against every other triangle in the body:
     *
     *     varac    0 of 140 unobstructed      massiff  68 of 280
     *     pup      0 of 140                   tuk      68 of 280
     *     blurrg   0 of 140                   hawk     48 of 160
     *     charger  0 of 140                   tooka    33 of 140
     *     pouncer  0 of 140                   taun     21 of 140
     *     brute    0 of 140                   acklay   38 of 140
     *
     * Six of the thirteen creature bodies, and the massiff's 68 is its UPPER
     * pair alone — the nexu branch's second pair, the thing that makes a
     * four-eyed animal read as four-eyed, was also entirely inside the skull.
     * It survived two full rebuilds of these heads, a body-lane pass that
     * photographed every creature, and a written note in Bodies.js that
     * diagnosed the fault on ONE branch and fixed it there.
     *
     * It survived because nothing measured it. Every other bound in this file
     * is a proportion or a cost — heads tall, triangles, IoU at thirty metres
     * — and a buried eye changes none of them: the geometry is built, it is in
     * the merge, it is in the triangle count, and it is invisible. The only
     * instrument that could have caught it was somebody looking at a
     * head-filling render of all twelve, and that is a thing that happens once.
     *
     * ── WHAT THE BOUND IS AND WHY IT IS THAT NUMBER ──────────────────────
     *
     * A quarter of one eye's own triangles is the ceiling, not the target: an
     * eye is a ball seated in a face, so the whole back of it faces the head
     * it is sitting in and can never be clear. Measured across the roster
     * after the seats were fixed, the worst eye in the game is the wookiee's
     * at 24.3% and the best is the astromech's lens at 50%. `MIN` is 0.20 —
     * under every shipped body with 21% of headroom on the tightest, and well
     * over the two states this is here to catch: 0% for an eye inside its own
     * skull, and 15% for the tauntaun's, which stood 10 mm proud of an 88 mm
     * ball and read as a smudge.
     *
     * ── AND IT IS DRIVEN FROM THE TWO TABLES, NOT FROM A LIST ────────────
     *
     * `COMPANION_KINDS` through each row's own archetype builder, plus every
     * `CREATURE_PLANS` row through `buildQuadruped`. A kind added tomorrow is
     * measured the day it is added, which is the whole reason the defect
     * lasted: the two head branches that shipped with no visible eye were both
     * SHARED by three bodies each, so any list that named the animals somebody
     * happened to be looking at would have missed the other four.
     *
     * A body whose eye is meant to be hidden says so on the material —
     * `eyeMat(colour, intensity, true)` — and never by name. Nothing declares
     * it today and the count is reported, so an exemption cannot be added in
     * silence. Having no eye at all is not an exemption: it is the failure.
     */
    const { COMPANION_KINDS } = await import('../../src/game/CompanionKinds.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');

    const MIN = 0.20;
    const roster = [];
    for (const id of Object.keys(COMPANION_KINDS)) {
      const type = COMPANION_KINDS[id].archetype ?? id;
      const A = ARCHETYPES[type];
      assert(A && typeof A.build === 'function', `companion ${id} names archetype "${type}" and nothing builds it`);
      roster.push([`companion ${id}`, A.build({ scale: A.scale ?? 1 })]);
    }
    for (const kind of Object.keys(B.CREATURE_PLANS)) {
      roster.push([`creature ${kind}`, B.buildQuadruped({ kind, scale: 1 })]);
    }
    assert(roster.length >= 25,
      `only ${roster.length} bodies were looked at — twelve companion kinds and thirteen creature plans is 25`);

    const rows = [], blind = [], worst = { f: 2, who: '' };
    let exempt = 0;
    for (const [who, built] of roster) {
      const root = built?.rig?.root ?? built?.group;
      assert(root, `${who} built neither a rig nor a group`);
      const { eyes, all } = bodyTris(root);
      /* NO EYE GEOMETRY IS THE LOUDER FAILURE and it has to be checked first:
       * a per-eye bound over an empty set passes vacuously, which is HANDOFF
       * §2.3's "0 passed, 0 failed reads as success" wearing a different hat. */
      assert(eyes.length,
        `${who} has no mesh declaring \`role: 'eye'\` — nothing on this body is an eye, `
        + 'so nothing can be measured and nothing would ever fail here');
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
      const eps = size * 1e-5;
      const per = [];
      for (const ball of eyeballs(eyes)) {
        if (ball.every((e) => e.hidden)) { exempt++; per.push('hidden'); continue; }
        const { clear, total } = clearFraction(ball, all, eps);
        const f = clear / total;
        per.push(`${clear}/${total}`);
        if (f < worst.f) { worst.f = f; worst.who = `${who} ${clear}/${total}`; }
        if (f < MIN) {
          blind.push(`${who} ${clear}/${total} = ${(f * 100).toFixed(0)}%`);
        }
      }
      rows.push(`${who.split(' ')[1]} [${per.join(' ')}]`);
    }
    assert(!blind.length,
      `${blind.join(', ')} — an eye whose own triangles are looking at the inside of its own head. `
      + `Every eye has to keep ${(MIN * 100).toFixed(0)}% of itself clear of the body it is set in`);

    /**
     * ── AND THE BOUND IS PROVED ON ITSELF, IN THE SAME CHECK ─────────────
     *
     * A visibility measurement is exactly the kind that passes for years while
     * measuring nothing — the geometry exists, the triangle count is right,
     * the ray test runs and reports a number, and the number is meaningless if
     * the occluder set or the normal is wrong. So one eye is pushed back into
     * the skull it came out of and the same function is asked again: it has to
     * report it BURIED. `positive control` rather than a comment claiming the
     * check works.
     *
     * The push is toward the head BONE's origin, which on every creature sits
     * behind the skull where the neck leaves the shoulders — so 55% of the way
     * there is unambiguously inside the animal, and it needs no per-body
     * number to be sure of that. The vertices are moved IN PLACE, which is the
     * point: `eyes` and `all` hold the same triangle objects, so the control's
     * eye is buried in the same body that is asked about it rather than in a
     * copy that has drifted from it.
     */
    const ctl = B.buildQuadruped({ kind: 'massiff', scale: 1 });
    const ctlT = bodyTris(ctl.rig.root);
    const balls = eyeballs(ctlT.eyes);
    assert(balls.length === 4, `the massiff has four eyes and the control found ${balls.length}`);
    const hp = ctl.rig.worldPos('head', new THREE.Vector3());
    const sz = new THREE.Box3().setFromObject(ctl.rig.root).getSize(new THREE.Vector3()).length();
    const before = clearFraction(balls[0], ctlT.all, sz * 1e-5);
    assert(before.clear / before.total >= MIN,
      `the control's own eye measured ${before.clear}/${before.total} before it was touched`);
    for (const e of balls[0]) for (const v of e.t) v.lerp(hp, 0.55);
    const after = clearFraction(balls[0], ctlT.all, sz * 1e-5);
    assert(after.clear / after.total < MIN,
      `an eye pushed 55% of the way back toward the head bone still measured ${after.clear}/${after.total} `
      + 'clear — this check cannot fail and is therefore not a check');

    /* AND THE EXEMPTION IS EXERCISED, for the reason HANDOFF §2.3b gives: the
     * `hidden` door above has no caller in the shipped tree, and a branch
     * nothing takes is a branch nobody knows is broken. The same buried eye,
     * with `hidden` on its material, has to come back exempt rather than
     * failing — so a body that one day genuinely wants an eye under a cowl has
     * a door that is known to work, and a reader can see what it costs. */
    let hidMat = null;
    ctl.rig.root.traverse((o) => { if (o.isMesh && o.material?.userData?.role === 'eye') hidMat = o.material; });
    assert(hidMat, 'the control body has no eye material to exempt');
    hidMat.userData.hidden = true;
    const exempted = eyeballs(bodyTris(ctl.rig.root).eyes).filter((ball) => ball.every((e) => e.hidden));
    assert(exempted.length === 4,
      `marking the eye material hidden exempted ${exempted.length} of the massiff's four eyes — `
      + 'the door the check offers a cowled body does not open');
    delete hidMat.userData.hidden;

    return `${rows.length} bodies, worst eye ${worst.who} = ${(worst.f * 100).toFixed(1)}% against a ${(MIN * 100).toFixed(0)}% floor`
      + `; ${exempt} declared hidden; control ${before.clear}/${before.total} → ${after.clear}/${after.total} when buried`
      + ` — ${rows.join(' ')}`;
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

  /**
   * A FIGURE THAT IS NOT 1.78 M TALL IS STILL HOLDING ITS OWN WEAPON.
   *
   * Reported as "the blade floats above them, both their arms in the air too",
   * and that is an arm solver working correctly against a target authored for
   * somebody else. `Player.chest` was a flat 1.34 m and `eyeHeight` a flat
   * 1.62 for every species in the game; `SPECIES.smallfolk.frame.stature` has
   * said 0.66 since the row was written and had no reader anywhere in src/.
   * On a 0.66 m figure that is a guard point — which is where the hilt hangs —
   * roughly 0.6 m over the top of its own head.
   *
   * The check is deliberately about the RELATION rather than about 1.34: the
   * chest has to be inside the body it belongs to. `stature` is asserted to be
   * read at all, because the failure mode here is silence — an unread field
   * looks exactly like a field that agrees with the default.
   */
  check('species: a small figure holds the hilt at its own chest, not a human’s', () => {
    // `frame.stature` is in METRES — the small-folk row says 0.66 and its own
    // comment says "3.6 heads tall at 0.72 m". A species that declares none is
    // a human, and this is how tall a human is.
    const HUMAN_H = 1.78;

    for (const sp of B.SPECIES) {
      const st = (sp.frame?.stature ?? HUMAN_H) / HUMAN_H;
      const built = B.buildJedi({ species: sp.id });
      const box = new THREE.Box3().setFromObject(built.rig.root);
      const tall = box.max.y - box.min.y;

      // The declared stature has to be the height the builder actually emits,
      // or the number the game scales by is fiction. 12% because the figure is
      // measured in a T-pose with hair and ears on it.
      const want = HUMAN_H * st;
      assert(Math.abs(tall - want) / want < 0.12,
        `${sp.id} declares stature ${st} (${want.toFixed(2)} m) and builds ${tall.toFixed(2)} m`);

      // …and the chest the hilt hangs from has to be inside that figure. Below
      // the crown of the head, above the hip: a guard point outside this band
      // is one the arms cannot reach, which is the whole defect.
      // Measured as a FRACTION of the figure's own height rather than against
      // its box, because the box is in bind pose with the feet below the root.
      const chest = (1.34 * st) / tall;
      assert(chest < 0.95,
        `${sp.id}: the chest sits at ${(chest * 100).toFixed(0)}% of a ${tall.toFixed(2)} m figure — over its own head`);
      assert(chest > 0.45,
        `${sp.id}: the chest sits at ${(chest * 100).toFixed(0)}% of a ${tall.toFixed(2)} m figure — below its own hips`);
    }
    return B.SPECIES.map(s => `${s.id} ${(s.frame?.stature ?? HUMAN_H).toFixed(2)}m`).join(' ');
  });

  /**
   * …AND ITS CLOTHES ARE ITS OWN SIZE. Cloth.js reads `opts.scale ?? 1`, so a
   * cape ordered 0.86 m long is 0.86 m long on a 0.66 m figure — a garment
   * longer than the character in it. Enemy.js passed `scale: A.scale` from the
   * day capes existed and Player.js did not, which is the same hand-written
   * twin that had the player's own gait solved at scale 1.
   */
  check('species: the cape is cut to the figure, and Player asks for that', async () => {
    const src = await (await import('node:fs/promises'))
      .readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const cloak = src.match(/attachCloak\(this\.world\.scene, this\.rig, \{[^}]*\}/s);
    assert(cloak, 'Player no longer attaches a cloak the way this check reads it');
    assert(/\bscale:/.test(cloak[0]),
      'Player orders a cape without a scale — every species wears a human’s cape');
    const skirt = src.match(/attachSkirt\(this\.world\.scene, this\.rig, \{[^}]*\}/s);
    assert(skirt && /\bscale:/.test(skirt[0]),
      'Player orders a robe skirt without a scale');
    /**
     * THE REAL END OF THE FUNCTION, and the real START of it.
     *
     * This was `src.match(/_updateBlade[\s\S]{0,4000}/)`, and the FIRST
     * `_updateBlade` in Player.js is at line 365 — inside a doc comment, 4384
     * lines above the method. So the check has been reading four thousand
     * characters of PROSE about the blade anchor and finding the word
     * `stature` in it, which is why its claim survived the code changing
     * underneath: the anchor is scaled by `limbs.stand` now, not by `stature`,
     * and the note there spends a paragraph on why (stature is a fraction of
     * total HEIGHT, and smallfolk's legs and torso are not scaled alike —
     * measured, 0.371 against the 0.340 the bones give, which put the guard
     * 4 cm too high on a figure with a 23 cm arm).
     *
     * `\n  _updateBlade(` is the method and not a mention of it, and the
     * assertion now says what the code actually promises: the anchor is a
     * height on THIS body, with `stature` as the fallback for a body whose
     * bones are not built yet, and never a constant.
     */
    const blade = functionBody(src, '\n  _updateBlade(');
    assert(/this\.stature\s*=/.test(src), 'Player no longer derives a stature at all');
    assert(/this\.limbs\?\.stand\s*\?\?\s*this\.stature\s*\?\?\s*1/.test(blade),
      'the blade anchor is no longer scaled by the figure’s own height — a species that is not '
      + 'human-sized holds the hilt at a human’s chest');
    assert(/chest\.copy\(this\.position\)[\s\S]{0,120}\*\s*st\b/.test(blade),
      'the chest anchor is derived without that scale, so nothing hanging off it moves with the figure');
    return 'cape, skirt and blade anchor all scale with the figure';
  });

  check('characters: a rifle points where its owner is aiming', () => {
    /**
     * NOTE #32: "the troopers (at least the clones but probably others too
     * tbh) hold their weapons really awkwardly like it's really bad, kind of
     * takes you out of it sometimes."
     *
     * Measured on the shipped tree, a clone trooper aiming at a target twenty
     * metres dead ahead pointed its barrel **77.6 degrees away from the aim** —
     * very nearly across its own body. The cause is one axis: the hand was
     * oriented by putting its +Y up the aim line, and a blaster's barrel is
     * its own +Z. Perpendicular axes, so aiming one aimed nothing.
     *
     * This is measured through the real rig, the real IK and the real weapon
     * attachment, because every part of that chain can put the bore somewhere
     * else and none of them can be read off the source.
     */
    const rows = [];
    for (const type of ['trooper', 'b1', 'b2', 'sniper', 'heavy', 'arc']) {
      const w = gunWorld();
      const e = new Enemy(w, type, new THREE.Vector3(0, 0, 0));
      if (!e.weapon) continue;
      e.facing = 0;
      const at = new THREE.Vector3(0, 1.4, 20);
      e.target = { position: at, chest: at, dead: false, alive: true };
      const ctx = { terrain: w.terrain, physics: w.physics, particles: null, time: 0, enemies: [] };
      for (let i = 0; i < 30; i++) e._pose(1 / 60, ctx);
      e.rig.root.updateMatrixWorld(true);
      e.weapon.updateMatrixWorld(true);
      const muzzle = (e.weapon.userData.muzzle || new THREE.Vector3(0, 0, 0.34))
        .clone().applyMatrix4(e.weapon.matrixWorld);
      const root = new THREE.Vector3().applyMatrix4(e.weapon.matrixWorld);
      const bore = muzzle.clone().sub(root).normalize();
      const aim = at.clone().sub(e.rig.worldPos('chest', new THREE.Vector3())).normalize();
      const off = Math.acos(Math.max(-1, Math.min(1, bore.dot(aim)))) * 180 / Math.PI;
      /* 12 degrees. Not zero: the hand is IK'd to a point and the weapon hangs
       * off a bone with its own rest pose, so a body whose arms cannot quite
       * reach the bore line will be a few degrees out and should be. What is
       * refused is a weapon held across the chest. */
      assert(off < 12,
        `a ${type} aiming straight ahead points its barrel ${off.toFixed(1)}° away from the aim`);
      /* AND BOTH HANDS ARE ON THE WEAPON. The support hand off the bore line
       * is the other half of the reference pose — in it the two hands are on
       * one line with the fore-end between them, and what was here put them on
       * opposite sides of the centreline. */
      if (!e.A.custom) {
        const hL = e.rig.worldPos('handL', new THREE.Vector3());
        const d = hL.clone().sub(root);
        const perp = d.clone().addScaledVector(bore, -d.dot(bore)).length();
        assert(perp < 0.30,
          `a ${type}'s support hand is ${(perp * 100).toFixed(0)} cm off the line of its own weapon`);
      }
      rows.push(`${type} ${off.toFixed(1)}°`);
    }
    assert(rows.length >= 4, `only ${rows.length} armed bodies measured`);
    return `bore against aim: ${rows.join(', ')}`;
  });

}
