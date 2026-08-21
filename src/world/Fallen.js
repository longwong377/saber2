/**
 * BATTLEFRONT BORZ — THE DEAD MARK THE FRONT.
 *
 * `FLAGSHIP.md` §12.4, verbatim: *"**The dead mark the front**: 520 prone
 * instanced figures in a 26 m band, thickest at the choke, one draw call."*
 *
 * `src/world/Front.js` listed this as the one of its five ground marks that was
 * **absent, and not faked** — "there is no instanced-corpse builder anywhere in
 * the tree: `Corpses.js` holds real ragdolled bodies with a budget of a few
 * dozen, which is a completely different object." This is that builder, and it
 * is the same object the colosseum's crowd is: one geometry, one material, one
 * `InstancedMesh`, per-instance colour, no physics, no cutting, no shadow-cast.
 * `Props.seatCrowd` puts 3,240 figures in a bowl for one call; this puts a few
 * hundred on the ground for two, and the argument is identical.
 *
 * ── WHY THIS AND NOT MORE CORPSES ───────────────────────────────────────
 *
 * `Corpses.js` holds bodies that were ALIVE — they have a rig, a garment, a
 * cloth solver and capsules, they can be cut, and the budget on them is a few
 * dozen because each one is 26 draw calls (§4). A field of the fallen is the
 * opposite object in every respect: nobody was ever alive in it, nothing can
 * interact with it, and the number of them IS the content. §11's own account of
 * why the reference plates are brutal names this first — *"what does it: the
 * **quantity of the fallen**, the **indifference** of the living walking past"*
 * — and quantity is exactly the axis a real body cannot be scaled along.
 *
 * ── WHAT A PRONE FIGURE HAS TO CARRY, AND AT WHAT SIZE ──────────────────
 *
 * A man lying down is 1.8 m long and about 0.45 m tall. On this ground at the
 * distances the front is read from that is:
 *
 *     20 m    81 px long, 20 px tall     — the shape has to be right
 *     60 m    27 px                      — silhouette and value only
 *    140 m    11 px                      — a dark dash, and past the ink
 *
 * So the figure is built for the 27 px reading and checked at 81: a torso, a
 * head, one arm thrown out and the legs apart. Sixty-eight triangles. §11's
 * "value, not hue, at scale" is why the variation is per-instance TONE rather
 * than per-instance geometry — at 11 px a second silhouette buys nothing, and
 * two flat tones with 0.18 luma between them is the whole of what survives.
 *
 * ── AND WHY IT IS TWO CALLS AND NOT ONE ─────────────────────────────────
 *
 * Two poses — sprawled and curled — because one pose repeated four hundred
 * times over 26 m of open ground is a pattern, and a pattern reads as a decal
 * (the exact fault `Front.walkingBarrage` avoids by jittering, and the exact
 * fault the crowd was rebuilt to fix). §12.4 asks for one draw call; the honest
 * price of not repeating one silhouette four hundred times is two, and two is
 * still 0.4% of this level's 520-call budget.
 */

import * as THREE from 'three';
import { makeRng, clamp, lerp, TAU } from '../engine/MathUtil.js';
import { mergeGeos } from './Props.js';

/** How long a man is, lying down. Everything else is a fraction of it. */
const LEN = 1.80;

/**
 * The two poses, in a frame where +Z is head-to-foot and the body lies in the
 * XZ plane. Both are built from boxes: a prone body at 27 px has no curve on
 * it that a six-sided cylinder would buy back.
 */
function sprawled() {
  const parts = [];
  const box = (w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  // torso, face down, chest a little proud of the sand
  box(0.46, 0.26, 0.62, 0, 0.13, 0.10);
  // hips and the two legs, apart and slack
  box(0.40, 0.22, 0.22, 0, 0.11, -0.28);
  box(0.16, 0.17, 0.52, -0.11, 0.085, -0.62, 0.16);
  box(0.16, 0.17, 0.48, 0.13, 0.085, -0.64, -0.22);
  // one arm thrown out — the single most legible thing about a body on the
  // ground, and the reason this pose is not a sack
  box(0.44, 0.13, 0.14, -0.34, 0.065, 0.24, 0.5);
  box(0.13, 0.13, 0.34, 0.24, 0.075, 0.30, -0.3);
  // head, low and turned
  const h = new THREE.SphereGeometry(0.115, 6, 4);
  h.scale(1.0, 0.85, 1.05);
  h.translate(0.05, 0.115, 0.50);
  parts.push(h);
  return mergeGeos(parts);
}

function curled() {
  const parts = [];
  const box = (w, hh, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, hh, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  // on its side, knees up: shorter, taller, and a completely different blob
  box(0.34, 0.40, 0.56, 0, 0.20, 0.06);
  box(0.32, 0.34, 0.26, 0.04, 0.17, -0.28);
  box(0.16, 0.30, 0.40, 0.10, 0.15, -0.52, 0.34);
  box(0.15, 0.26, 0.36, -0.08, 0.13, -0.50, -0.20);
  box(0.34, 0.13, 0.14, -0.20, 0.28, 0.22, 0.9);
  const h = new THREE.SphereGeometry(0.115, 6, 4);
  h.scale(1.0, 1.0, 0.95);
  h.translate(-0.02, 0.30, 0.40);
  parts.push(h);
  return mergeGeos(parts);
}

let _geos = null;
function fallenGeometry() {
  if (!_geos) {
    /* ONE PER PROCESS, exactly as `smokeMaterial` is and for the same reason:
     * `World.unload` disposes a static's geometry, so a geometry allocated per
     * level is a geometry leaked per level. These are shared, so the field
     * clones nothing and disposes nothing — it hands back the instance count.
     * The scale to LEN is applied here so both poses measure the same man. */
    const a = sprawled(), b = curled();
    for (const g of [a, b]) { g.scale(1, 1, LEN / 1.8); g.computeVertexNormals(); }
    _geos = [a, b];
  }
  return _geos;
}

let _mat = null;
function fallenMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  /* PER-INSTANCE COLOUR AND NOTHING ELSE. `instanceColor` multiplies the base,
   * so white here means the instance tone IS the colour — one material for
   * both armies. Rule 8: nothing is shiny, and a specular lobe on four hundred
   * backs is a field of sparkle where there should be a field of the dead. */
  _mat.userData.weather = 0;
  return _mat;
}

/**
 * SCATTER THE FALLEN ALONG A LINE.
 *
 * @param world        needs `scene`, `statics`, and `terrain` to lie on
 * @param opts.origin  {x,z} a point ON the line
 * @param opts.dir     {x,z} unit, the axis of advance; the band runs ACROSS it
 * @param opts.count   how many bodies
 * @param opts.half    how far along the line to spread them, metres
 * @param opts.depth   the band's 1σ across the line, metres. §12.4's 26 m band
 *                     is 2σ ≈ 26, so 6.5 either side of the line.
 * @param opts.palette per-army tones, picked per body
 * @returns {{mesh: THREE.Group, count: number, calls: number}|null}
 */
export function addFallen(world, opts = {}) {
  if (!world?.scene) return null;
  const n = Math.max(0, Math.round(opts.count ?? 260));
  if (!n) return null;
  const T = world.terrain;
  const rng = makeRng(opts.seed ?? 4211);
  const o = opts.origin || { x: 0, z: 0 };
  const d = opts.dir || { x: 1, z: 0 };
  const ax = -d.z, az = d.x;
  const half = opts.half ?? 150;
  const depth = opts.depth ?? 6.5;
  /* THE THREE FLAT TONES §11 ASKS FOR, and they are the armies' own: clone
   * plastoid is the pale one, a droid's shell is the mid one, and the dark one
   * is what a body that has been burnt or lain a while is. Three, not a ramp:
   * "three bands with ≥0.18 luma separation" is the rule, and a continuous
   * random tone across four hundred bodies has none. */
  const palette = (opts.palette || [0x9a958c, 0x8a6b46, 0x4c4038]).map((h) => new THREE.Color(h));

  const geos = fallenGeometry();
  const bins = geos.map(() => []);
  const tint = geos.map(() => []);
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    /* ALONG the line: uniform, but CLUMPED — men die where the fighting was,
     * and a Poisson scatter of four hundred bodies over 300 m is a lawn. Each
     * body is drawn near one of a handful of knots, which is the same thing
     * `strewGround`'s density does one level up and the same statistic §12
     * says Clark–Evans cannot see. */
    const knot = Math.floor(rng() * 7);
    const centre = (knot / 6 - 0.5) * 2 * half * 0.86;
    const along = clamp(centre + (rng() + rng() + rng() - 1.5) * half * 0.30, -half, half);
    /* ACROSS it: a sum of three uniforms is a fair enough normal, and the band
     * is deliberately BIASED to the burnt side — the line advanced over this
     * ground, so the men who fell short of it are on the near half and the
     * ones who fell taking it are past. 0.35 of a sigma is what that bias is
     * worth; anything more and the band stops straddling the line at all. */
    const across = (rng() + rng() + rng() - 1.5) * depth * 1.4 + depth * 0.35;
    const x = o.x + d.x * across + ax * along;
    const z = o.z + d.z * across + az * along;
    if (T?.inBounds && !T.inBounds(x, z)) continue;
    /* SUNK. A body on sand is IN it by a few centimetres, and — more to the
     * point — a prone box sitting exactly on a heightfield reads as furniture.
     * The sink is what makes it read as lying rather than as placed. */
    const y = (T ? T.height(x, z) : 0) - 0.045;
    if (T?.normalAt) T.normalAt(x, z, nrm); else nrm.copy(up);
    q.setFromUnitVectors(up, nrm);
    qy.setFromAxisAngle(up, rng() * TAU);
    q.multiply(qy);
    p.set(x, y, z);
    s.setScalar(lerp(0.92, 1.10, rng()));
    const v = rng() < 0.62 ? 0 : 1;
    bins[v].push(m.compose(p, q, s).clone());
    const pk = rng();
    tint[v].push(palette[pk < 0.44 ? 0 : pk < 0.82 ? 1 : 2]);
  }

  const group = new THREE.Group();
  group.name = 'fallen';
  let calls = 0, placed = 0;
  for (let v = 0; v < geos.length; v++) {
    const list = bins[v];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geos[v], fallenMaterial(), list.length);
    for (let i = 0; i < list.length; i++) {
      im.setMatrixAt(i, list[i]);
      im.setColorAt(i, tint[v][i]);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    /* RECEIVES, NEVER CASTS. A body lying on the ground casts a shadow a few
     * centimetres long that nothing can see, and four hundred casters in a
     * shadow map sized for a fight is the crowd's own trade made again. What
     * it must do is RECEIVE, or the field stays lit while the ground around it
     * goes into the smoke's shade. */
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = 'fallen';
    group.add(im);
    calls++; placed += list.length;
  }
  if (!placed) return null;
  world.scene.add(group);
  world.statics?.push(group);
  return { mesh: group, count: placed, calls };
}

/** Exported so a check cannot keep a second copy of how long a man is. */
export const FALLEN_LENGTH = LEN;
