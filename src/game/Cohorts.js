/**
 * BATTLEFRONT BORZ — L3, the instanced cohort. FLAGSHIP.md §14 Step 5.
 *
 * ── WHERE THE BAND IS, AND WHY IT IS NOT A NUMBER SOMEBODY CHOSE ──────────
 *
 * §14 Step 5 says "beyond 140 m". The ink prepass says 137.8, and it says it
 * for a reason that decides the whole design: `OutlinePass.prepass` narrows its
 * own camera to `min(uHaze.y, uEdge.y) · 1.06`, and `INK.edgeFade[1]` is 130 —
 * so in clear air THE GAME DRAWS NO OUTLINE ON ANYTHING PAST 137.8 m, today,
 * before any of this. Haze only shortens that reach further.
 *
 * That is the licence L3 needs. The one thing a cohort could ruin is the
 * silhouette line, because an instanced body cannot carry a per-body outline
 * pass — and past this distance there is no line to ruin. So `L3_AT` is read
 * off `INK.edgeFade`, not typed, and `tools/checks/frame-budget.mjs` drives the
 * shipped `prepass` on every level and every quality tier and asserts that its
 * far plane never reaches a body a cohort has taken. Move `INK.edgeFade` and
 * the band moves with it.
 *
 * ── WHAT A COHORT IS ─────────────────────────────────────────────────────
 *
 * One `InstancedMesh` per (archetype · elite · scale) × material bin, holding
 * every body of that kind past the band. The geometry is the L2 merged skin
 * (src/game/MergedSkin.js) with the skinning collapsed: one 4×4 per BONE, not
 * per vertex, because every L2 vertex rides exactly one bone at weight 1.0.
 * Nothing is re-authored and nothing is decimated — a cohort instance is the
 * same triangles the merged skin was drawing one metre closer.
 *
 * The cost stops depending on how many bodies there are. L2 is ~4.6 draw calls
 * a body; L3 is ~4 calls an ARCHETYPE. Measured on a real `high` World on
 * geonosis, the same field the L2 rung was measured on:
 *
 *     42 bodies at 150-204 m     L2 194 calls  →  L3 27      (7.2×)
 *     168 bodies, same field     L2 776 calls  →  L3 27      (28.7×)
 *
 * ── ANIMATION IS IN THE MATRIX, NOT IN THE VERTEX SHADER ─────────────────
 *
 * §14 Step 5 proposes "a per-instance phase in the vertex shader". That cannot
 * work in this renderer and the reason is worth writing down: the ink prepass
 * renders the scene with `scene.overrideMaterial = normalMat`, so a vertex
 * displacement living in a body's own material is not in the shader the prepass
 * compiles. A cohort that walked in its vertex shader would have its OUTLINE
 * drawn at the un-walked pose. Inside the band that is a body wearing somebody
 * else's edge; outside it there is no outline at all, which is the case here —
 * but the mechanism would be a trap the day the band moved.
 *
 * So a cohort carries a pose and moves in its INSTANCE MATRIX: position, facing
 * and the body's own scale, rewritten every frame. Bodies still march, wheel
 * and close. What is dropped is the gait, and that is dropped on a measurement:
 * at 138 m a 0.86 m leg is 3.9 px, and the body's own silhouette moves more
 * between two frames of its walk cycle than the frozen pose differs from any of
 * them. The numbers are in `tools/checks/frame-budget.mjs` §7.
 *
 * ── WHAT A COHORT CANNOT DO ──────────────────────────────────────────────
 *
 * Stated here because it is the part a player could notice, not the draw call:
 *
 *   ITS OWN POSE. Every instance of one cohort wears one pose. A body that
 *   kneels, staggers, is held or is knocked down past the band still stands.
 *   `Enemy.crouch` is the writer that could show; nothing else in the roster
 *   changes a standing body's outline by more than the gait already does.
 *
 *   COME APART. A cut body leaves its cohort on the frame it is cut, exactly as
 *   the L2 skin does, and falls back to drawing itself. Nothing in the game can
 *   reach one: the longest blade in the roster is under 2 m and the longest
 *   Force power is 24 m, both measured in the check.
 *
 *   A RAGDOLL. `Actor.goRagdoll` re-homes the meshes onto physics holders,
 *   which are the body's own draw calls again. Corpses are not cohort members.
 *
 *   BE MISSED BY A BOLT. It can NOT do this — and that is the point. Hit tests
 *   read `Enemy.capsules` and the physics proxy, neither of which this touches,
 *   so a cohort trooper shoots, is shot, takes damage and dies on the same
 *   frame it would have without the rung. The rendering is what changed.
 */

import * as THREE from 'three';
import { INK } from '../toon/Ink.js';
import { buildMergedSkin, applyMergedSkin } from './MergedSkin.js';

const _m = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _yaxis = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * The distance a body stops drawing itself and becomes an instance.
 *
 * DERIVED: it is the far plane `OutlinePass.prepass` gives its own camera in
 * clear air. Past it no outline is drawn on anything, which is the one thing an
 * instanced body cannot carry. `1.06` and `edgeFade[1]` are that function's own
 * two terms; if it stops being the binding one, the check in frame-budget.mjs
 * fails rather than this constant going quietly stale.
 */
export const L3_AT = INK.edgeFade[1] * 1.06;

/** One cohort creation a frame. The freeze is the expensive part — see `_budget`. */
export const JOINS_PER_FRAME = 1;
const _budget = { at: -1, spent: 0 };

/** How many instances a cohort starts with; it doubles rather than refusing. */
const START_CAP = 64;

/* ── the freeze ───────────────────────────────────────────────────────── */

/**
 * The L2 skin's bins as STATIC geometry in a canonical body frame.
 *
 * Every L2 vertex rides one bone at weight 1.0 (asserted in frame-budget.mjs),
 * so the skinning collapses to one matrix per BONE rather than per vertex:
 *
 *     F[b] = Ry(−facing) · T(−anchor) · bone.matrixWorld · boneInverse[b] · bindMatrix
 *
 * `anchor` is the body's ground position and `facing` its yaw, so what comes out
 * stands at the origin looking down +Z whatever the body was doing — and the
 * instance matrix that puts it back is `T(position) · Ry(facing)`, whose
 * constant offset against the rig's own convention cancels by construction.
 */
function freezeSkin(skin, anchor, facing) {
  const out = [];
  for (let b = 0; b < skin.meshes.length; b++) {
    const mesh = skin.meshes[b];
    const geo = mesh.geometry;
    const P = geo.attributes.position, N = geo.attributes.normal;
    const SI = geo.attributes.skinIndex;
    const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses;

    const canon = new THREE.Matrix4()
      .makeRotationY(-facing)
      .multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
    const F = bones.map((bone, i) => new THREE.Matrix4()
      .multiplyMatrices(bone.matrixWorld, inv[i])
      .premultiply(canon)
      .multiply(mesh.bindMatrix));
    const NM = F.map((m4) => new THREE.Matrix3().getNormalMatrix(m4));

    const pos = new Float32Array(P.count * 3);
    const nrm = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const bi = SI.getX(i);
      _v.fromBufferAttribute(P, i).applyMatrix4(F[bi] || _m.identity());
      pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(NM[bi] || _nm.identity()).normalize();
      nrm[i * 3] = _v.x; nrm[i * 3 + 1] = _v.y; nrm[i * 3 + 2] = _v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    /* uv and colour come across UNTOUCHED — they are what makes a cohort the
     * same body rather than a grey proxy, and neither depends on the pose. */
    g.setAttribute('uv', geo.attributes.uv);
    g.setAttribute('color', geo.attributes.color);
    g.setIndex(geo.index);
    g.computeBoundingSphere();
    out.push({ geometry: g, material: mesh.material.clone() });
  }
  return out;
}

/* ── the field ────────────────────────────────────────────────────────── */

export class CohortField {
  constructor(scene) {
    this.scene = scene;
    this.cohorts = new Map();
    this.joins = 0;
    this.refused = new Map();
  }

  /**
   * What makes two bodies the same cohort.
   *
   * The elite modifier is in the key because its tell is a REPAINTED MATERIAL
   * (`Enemy.tintBones`) and the repaint lands in the merged skin's vertex
   * colours — so an elite sharing a plain body's bake would lose the one signal
   * that says it is worth more. The body's own scale is in it because a 1.18
   * B2 and a 1.02 B1 are not one silhouette.
   */
  keyFor(e) {
    return `${e.type}|${e.mod || '-'}|${(e.bodyScale ?? 1).toFixed(3)}`;
  }

  _cohortFor(e) {
    const key = this.keyFor(e);
    let c = this.cohorts.get(key);
    if (c !== undefined) return c;

    const skin = e._l2?.skin || buildMergedSkin(e.rig);
    if (!skin) { this.cohorts.set(key, null); this.refused.set('nothing to merge', (this.refused.get('nothing to merge') || 0) + 1); return null; }
    e.rig.root.updateMatrixWorld(true);
    for (const m of skin.meshes) m.updateMatrixWorld(true);

    const parts = freezeSkin(skin, e.position, e.facing);
    const meshes = parts.map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, START_CAP);
      im.name = `cohort:${key}`;
      im.userData.cohortL3 = true;
      im.count = 0;
      /* NOT FRUSTUM CULLED, deliberately. An InstancedMesh's bound is one
       * sphere over every instance in it, and three caches it on first use — so
       * a cohort that spread out after that sphere was taken would pop out of
       * the frame whole. A handful of draw calls is the cheaper mistake. */
      im.frustumCulled = false;
      /* `Enemy._applyLod` takes the shadow pass off a body at 62 m, and this
       * band starts at 138. Nothing here has cast one for seventy metres. */
      im.castShadow = false;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(im);
      return im;
    });
    c = { key, meshes, cap: START_CAP, high: 0, free: [], members: new Set() };
    this.cohorts.set(key, c);
    return c;
  }

  _grow(c) {
    const cap = c.cap * 2;
    for (let i = 0; i < c.meshes.length; i++) {
      const old = c.meshes[i];
      const im = new THREE.InstancedMesh(old.geometry, old.material, cap);
      im.name = old.name; im.userData.cohortL3 = true;
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceMatrix.array.set(old.instanceMatrix.array);
      im.count = old.count;
      this.scene.add(im);
      this.scene.remove(old);
      /* The geometry and the material are the SAME objects, shared with the
       * mesh being replaced, so neither is disposed here — only the buffer the
       * old InstancedMesh owned goes. */
      old.dispose();
      c.meshes[i] = im;
    }
    c.cap = cap;
  }

  /** Put `e` in its cohort, or return false and leave it drawing itself. */
  join(e) {
    if (e._l3) return true;
    const c = this._cohortFor(e);
    if (!c) return false;
    let slot = c.free.pop();
    if (slot === undefined) {
      if (c.high >= c.cap) this._grow(c);
      slot = c.high++;
    }
    for (const im of c.meshes) im.count = Math.max(im.count, c.high);
    c.members.add(e);
    e._l3 = { c, slot };
    this.joins++;
    this.place(e);
    return true;
  }

  /** Rewrite this body's instance matrix. One compose, however many bins. */
  place(e) {
    const L = e._l3;
    if (!L) return;
    _q.setFromAxisAngle(_yaxis, e.facing);
    _s.setScalar(1);
    _m.compose(e.position, _q, _s);
    for (const im of L.c.meshes) {
      _m.toArray(im.instanceMatrix.array, L.slot * 16);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Take `e` out. Its slot is zero-scaled, which is how an instance hides. */
  leave(e) {
    const L = e._l3;
    if (!L) return;
    for (const im of L.c.meshes) {
      _zero.toArray(im.instanceMatrix.array, L.slot * 16);
      im.instanceMatrix.needsUpdate = true;
    }
    L.c.free.push(L.slot);
    L.c.members.delete(e);
    e._l3 = null;
  }

  /**
   * Draw calls this field is spending, and over how many bodies.
   *
   * A cohort with no members left is not counted: `InstancedMesh.count` is 0
   * and an instanced draw of nothing is not a draw. The meshes are KEPT rather
   * than freed, because a wave of the same archetype is coming and the freeze
   * is the expensive part — but they must not appear in a budget.
   */
  stats() {
    let calls = 0, instances = 0, cohorts = 0, live = 0;
    for (const c of this.cohorts.values()) {
      if (!c) continue;
      cohorts++;
      instances += c.members.size;
      if (c.members.size > 0) { live++; calls += c.meshes.length; }
    }
    return { cohorts, live, calls, instances };
  }

  dispose() {
    for (const c of this.cohorts.values()) {
      if (!c) continue;
      for (const im of c.meshes) {
        im.geometry.dispose();
        im.material.dispose();
        im.dispose();
        im.removeFromParent();
      }
      for (const e of c.members) e._l3 = null;
      c.members.clear();
    }
    this.cohorts.clear();
  }
}

/* ── who owns `mesh.visible` ──────────────────────────────────────────── */

/**
 * TAKE THE BODY OFF THE SCREEN, and remember exactly what was on it.
 *
 * A cohort member must draw NOTHING of its own or the same triangles are
 * submitted twice. The list is taken rather than derived because at this point
 * three different rules have had a say in what is visible — the LOD's detail
 * cull, the L2 merge, and whatever the merge refused — and a fourth opinion
 * about which of them is showing is the defect this project keeps deleting.
 * What comes back is what was there.
 *
 * `rig.root.visible` is deliberately NOT the switch: `Enemy._auditVisible`
 * rewrites that field three times a second on the rule that a living body's
 * root is visible, and would have undone this between frames.
 */
function darken(owner) {
  if (owner._dark) return;
  const hidden = [];
  owner.rig.root.traverse((o) => { if (o.isMesh && o.visible) { o.visible = false; hidden.push(o); } });
  owner._dark = hidden;
}

export function undarken(owner) {
  if (!owner._dark) return;
  for (const o of owner._dark) o.visible = true;
  owner._dark = null;
}

/* ── the rung, as `Enemy._applyLod` uses it ───────────────────────────── */

function mayJoin(world) {
  const now = world?.time ?? 0;
  if (_budget.at !== now) { _budget.at = now; _budget.spent = 0; }
  if (_budget.spent >= JOINS_PER_FRAME) return false;
  _budget.spent++;
  return true;
}

/**
 * Is this body drawn by a cohort? Joins, leaves and re-places as needed.
 *
 * The eligibility rule is the L2 skin's, one band further out: a body that has
 * come apart or fallen over is not one of forty identical soldiers any more and
 * goes back to drawing itself.
 */
export function applyCohort(owner, lod) {
  const world = owner.world;
  const field = world?.cohorts;
  const fit = lod >= 3 && !!owner.rig && !owner.dead
    && !owner.actor?.ragdolled && !(owner.actor?.severedCount > 0);

  if (!field || !fit) {
    owner._l3Wait = false;
    if (owner._l3) field?.leave(owner);
    return false;
  }
  if (owner._l3) { field.place(owner); return true; }

  /* A cohort's first member pays for the freeze, so the same one-a-frame cap
   * the L2 bake has applies — and the same retry in `Enemy.update` for the same
   * reason: `_applyLod` is edge-triggered. A body waiting for a slot draws its
   * L2 merged skin, which is the set it was already drawing. */
  owner._l3Wait = true;
  if (!mayJoin(world)) return false;
  owner._l3Wait = false;
  if (!field.join(owner)) return false;
  darken(owner);
  return true;
}

/**
 * THE WHOLE LADDER IN ONE CALL, and one owner of `mesh.visible` at each rung.
 *
 * `Enemy._applyLod` and `Enemy.update` both go through here so the order can
 * never be got wrong: give the body back to itself, let the L2 merge decide
 * what draws, then let the cohort take it if it can. A body already in a cohort
 * short-circuits to rewriting one matrix, which is the steady state and has to
 * be cheap — the traversals above run on a band change and nowhere else.
 */
export function applyBodyLod(owner, lod) {
  /* `darken` again on the short-circuit, because `Enemy._applyLod` hands the
   * body back to itself before every rung decision and the steady state has to
   * survive that. It early-returns when the body is already dark, so the
   * per-frame path through here is still one matrix write. */
  if (owner._l3 && applyCohort(owner, lod)) { darken(owner); return true; }
  undarken(owner);
  applyMergedSkin(owner, lod);
  return applyCohort(owner, lod);
}
