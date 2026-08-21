/**
 * BATTLEFRONT BORZ — L2, the merged rigid skin. FLAGSHIP.md §14 Step 4.
 *
 * ── THE PROBLEM, AS A NUMBER ──────────────────────────────────────────────
 *
 * `Enemy._applyLod` already throws away the panel lines and the rivets past
 * thirty metres. What it cannot throw away is the SILHOUETTE — one primary
 * mesh per bone, plus whatever `markSilhouette` tagged — because that is the
 * thing you fight by. So a body has a floor, and the floor is high: measured
 * on a real `high` World on geonosis, 42 mixed bodies standing 72-127 m out
 * cost **1071 visible meshes**, 21 to 31 each, at every distance forever.
 * FLAGSHIP §4 states the same fact from the other side — "a trooper who walks,
 * shoots, takes cover and can be cut in half costs 26 draw calls at every
 * distance, forever" — and calls it the whole architecture.
 *
 * The floor is not made of geometry. It is made of MATERIAL BOUNDARIES. A
 * trooper's kept set is 26 meshes wearing 6 materials, and those 6 differ from
 * each other in `color`, `roughness` and `metalness` and in **nothing else**;
 * they share three textures between them. Six bins, not twenty-six.
 *
 * ── WHAT THIS DOES ────────────────────────────────────────────────────────
 *
 * At LOD 2 the kept set is baked, once, into one `SkinnedMesh` per material
 * bin: every vertex carries weight 1.0 on the single bone whose subtree it was
 * parented to. That is not skinning in the animation sense — it is exactly the
 * rigid parenting the scene graph was already doing, expressed as one draw call
 * instead of twenty-six. Consequences, in the order they matter:
 *
 *   THE SILHOUETTE IS IDENTICAL BY CONSTRUCTION. Same triangles, same bones,
 *   same transforms — the vertices are baked into the rig root's frame and
 *   carried back out by `boneMatrix · boneInverse`, which is the composition
 *   the graph walk performs anyway. There is no simplification, no decimation
 *   and no re-authoring; nothing was thrown away, so nothing can be missing.
 *   `tools/checks/frame-budget.mjs` rasterises both and holds them to it.
 *
 *   THE COLOUR IS IDENTICAL BY CONSTRUCTION TOO. `material.color` moves into a
 *   per-vertex colour attribute and the merged material's own colour is white.
 *   three's `<color_fragment>` is `diffuseColor *= vColor`, and both operands
 *   are in the linear working space, so white × the old colour is the old
 *   colour to the bit.
 *
 *   ROUGHNESS AND METALNESS ARE DROPPED, and that is a reading of the shipped
 *   shader rather than a shrug. src/toon/Cel.js deletes the GGX lobe, the sheen
 *   lobe and the environment reflection, and replaces the one line where
 *   `metalnessFactor` divided the diffuse — which is every consumer of either
 *   field. src/engine/Textures.js already stopped BINDING the ORM map for that
 *   reason. `tools/checks/frame-budget.mjs` reads `THREE.ShaderChunk` after
 *   `installCelShading` has run and fails if either term comes back.
 *
 *   EVERY OTHER MATERIAL FIELD SPLITS THE BIN, and the key is DERIVED from the
 *   material rather than listed here. A property added to a body's material
 *   tomorrow forces its own bin on the day it is authored instead of being
 *   silently averaged into somebody else's (HANDOFF §2.3).
 *
 * ── WHAT IS DELIBERATELY LEFT OUT OF THE MERGE ────────────────────────────
 *
 * A material whose drawn edge is not its geometry keeps its own draw call:
 * `cutsItsOwnSilhouette` is IMPORTED from src/toon/Ink.js, not restated, and it
 * is the same predicate the ink prepass uses to decide what to leave out of the
 * normal buffer. Fold a lit blade or a visor into an opaque body and two things
 * go wrong at once — the body gains an outline it should not have, and the
 * additive piece stops glowing. Cloth is out for a different reason and gets it
 * for free: `Cloth` puts its mesh on the SCENE, not under `rig.root`, because a
 * garment is solved in world space. Its vertices move every frame and a rigid
 * bind would freeze them.
 *
 * ── WHEN IT IS TORN DOWN ──────────────────────────────────────────────────
 *
 * The bake is a photograph of a rig with all its bones. A cut changes the
 * geometry under `bone.primary` and hides a subtree; a merged vertex cannot
 * know that, so it would carry a severed arm around. `staleness` therefore
 * watches the two counters that say the body is no longer the body that was
 * baked — `actor.severedCount` and `actor.ragdolled` — and drops the skin the
 * moment either moves. A cut body pays the old price, which is correct: it has
 * stopped being one of forty identical soldiers.
 */

import * as THREE from 'three';
import { cutsItsOwnSilhouette } from '../toon/Ink.js';

const _m1 = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();

/**
 * The distance the rung engages at.
 *
 * It is not a new number: `Enemy.update` already switches to LOD 2 at 62 m and
 * drops the shadow pass there, and FLAGSHIP §14 Step 5 hands everything past
 * 140 m to instanced cohorts. So L2 is the 62-140 m band, which is where a
 * front is, and this constant exists to be READ by the check rather than to be
 * a second opinion about the boundary — `Enemy` owns the comparison.
 */
export const L2_LOD = 2;

/* ── the bin key ──────────────────────────────────────────────────────── */

/**
 * Absorbed into the merged geometry, so a difference here does NOT split a bin.
 *
 *   color         becomes the per-vertex colour attribute, exactly.
 *   vertexColors  the merged material always has it on; the bake multiplies a
 *                 source's own attribute in when the source had it on and
 *                 substitutes the material colour when it did not, so both
 *                 kinds land in one bin without either changing.
 */
const ABSORBED = new Set(['color', 'vertexColors']);

/**
 * Reaches no surviving term in the shipped shader — see the header note and
 * the check in tools/checks/frame-budget.mjs that reads the chunks back.
 */
const DEAD_UNDER_CEL = new Set(['roughness', 'metalness']);

/** Bookkeeping three puts on every material; none of it changes a pixel. */
const NOT_APPEARANCE = new Set(['uuid', 'id', 'version', 'name', 'userData', '_listeners']);

let _objSeq = 0;
const _objIds = new WeakMap();
/** A stable id for an object three gave us no other handle on. */
function objId(o) {
  let id = _objIds.get(o);
  if (id === undefined) _objIds.set(o, (id = `obj${++_objSeq}`));
  return id;
}

/**
 * TWO TEXTURES ARE THE SAME TEXTURE IF THEY SAMPLE THE SAME, and that is not
 * the same question as `uuid`.
 *
 * src/engine/Textures.js bakes an albedo ONCE and then wraps it in a fresh
 * `CanvasTexture` per repeat — so a trooper's six materials carry four
 * distinct `armor` texture objects over one image. Keyed on uuid, the merge
 * refused to fold any of them together and a body came out at 6 bins instead
 * of 3. Keyed on what the sampler actually reads, they fold.
 */
function textureKey(t) {
  return [
    'tex', objId(t.image ?? t), t.repeat.x, t.repeat.y, t.offset.x, t.offset.y,
    t.center.x, t.center.y, t.rotation, t.wrapS, t.wrapT, t.magFilter, t.minFilter,
    t.anisotropy, t.colorSpace, t.flipY, t.premultiplyAlpha, t.channel, t.generateMipmaps,
  ].join(',');
}

function propKey(v, depth = 0) {
  if (v === null || v === undefined) return '-';
  if (v.isColor) return `#${v.getHexString()}`;
  if (v.isTexture) return textureKey(v);
  if (typeof v.toArray === 'function' && !Array.isArray(v)) return v.toArray().join(',');
  if (Array.isArray(v)) return `[${v.map((x) => propKey(x, depth + 1)).join(';')}]`;
  const t = typeof v;
  /* A plain object — `defines` is one, and three gives every material its own
   * `{ STANDARD: '' }` — is compared by CONTENT. By identity, `defines` alone
   * put every material in a bin of its own. */
  if (t === 'object' && depth < 3 && Object.getPrototypeOf(v) === Object.prototype) {
    return `{${Object.keys(v).sort().map((k) => `${k}:${propKey(v[k], depth + 1)}`).join(',')}}`;
  }
  if (t === 'object' || t === 'function') return objId(v);
  return String(v);
}

/**
 * What makes two materials the SAME merged material.
 *
 * Walked off the material's own keys rather than listed, for the reason
 * HANDOFF §2.3 gives: a list beside a generated thing drifts from it, and the
 * direction it drifts in here is the dangerous one — an unlisted property would
 * merge two materials that do not look alike.
 */
export function mergeBinKey(m) {
  const parts = [m.type];
  for (const k of Object.keys(m).sort()) {
    if (ABSORBED.has(k) || DEAD_UNDER_CEL.has(k) || NOT_APPEARANCE.has(k)) continue;
    parts.push(`${k}=${propKey(m[k])}`);
  }
  return parts.join('|');
}

/* ── what may be folded in ────────────────────────────────────────────── */

/** The bone whose frame this object rides in, or null if it rides none. */
function ownerBone(o, root) {
  for (let p = o.parent; p && p !== root.parent; p = p.parent) {
    if (p.userData && p.userData.bone) return p.userData.bone;
    if (p === root) return null;
  }
  return null;
}

/**
 * Why a mesh was left out — a string, or null when it may be merged.
 *
 * Returns the REASON rather than a boolean so the probe and the check can
 * report what a body could not fold and why, instead of reporting a number
 * that dropped for a cause nobody can name.
 */
export function refuseReason(o) {
  if (!o.isMesh) return 'not a mesh';
  if (o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return 'already batched';
  const m = o.material;
  if (!m) return 'no material';
  if (Array.isArray(m)) return 'material groups';
  if (!m.isMeshStandardMaterial) return `material is ${m.type}`;
  if (cutsItsOwnSilhouette(m)) return 'cuts its own silhouette';
  const g = o.geometry;
  if (!g || !g.attributes.position) return 'no position';
  if (!g.attributes.normal) return 'no normal';
  if (!g.attributes.uv) return 'no uv';
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return 'morph targets';
  return null;
}

/* ── the bake ─────────────────────────────────────────────────────────── */

function countOf(g) {
  return { v: g.attributes.position.count, i: g.index ? g.index.count : g.attributes.position.count };
}

/**
 * One bin's meshes into one geometry, in the rig root's frame, weight 1.0.
 *
 * `entries` are `{ mesh, boneIndex }`. `rootInv` is the inverse of the rig
 * root's world matrix at bake time — the frame every vertex is expressed in.
 */
function bakeBin(entries, rootInv) {
  let nv = 0, ni = 0;
  for (const e of entries) { const c = countOf(e.mesh.geometry); nv += c.v; ni += c.i; }

  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4);
  const sw = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);

  let vo = 0, io = 0;
  for (const e of entries) {
    const g = e.mesh.geometry;
    const mat = e.mesh.material;
    const c = countOf(g);
    _m1.multiplyMatrices(rootInv, e.mesh.matrixWorld);
    _nm.getNormalMatrix(_m1);
    /* A negative determinant is a mirrored transform, and a mirrored transform
     * turns every triangle inside out. Bodies.js authors its pairs rather than
     * mirroring them by scale for exactly this reason — but `squash` and the
     * archetype scales both go through here, so the winding is flipped when the
     * matrix says to rather than on a promise that it never happens. */
    const flip = _m1.determinant() < 0;

    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const C = mat.vertexColors ? g.attributes.color : null;
    for (let i = 0; i < c.v; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m1);
      pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      nrm[(vo + i) * 3] = _v.x; nrm[(vo + i) * 3 + 1] = _v.y; nrm[(vo + i) * 3 + 2] = _v.z;
      uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i);
      // linear working space on both sides — see the header
      col[(vo + i) * 3] = mat.color.r * (C ? C.getX(i) : 1);
      col[(vo + i) * 3 + 1] = mat.color.g * (C ? C.getY(i) : 1);
      col[(vo + i) * 3 + 2] = mat.color.b * (C ? C.getZ(i) : 1);
      si[(vo + i) * 4] = e.boneIndex;
      sw[(vo + i) * 4] = 1;
    }
    if (g.index) {
      const I = g.index;
      for (let i = 0; i < c.i; i += 3) {
        idx[io + i] = vo + I.getX(flip ? i + 2 : i);
        idx[io + i + 1] = vo + I.getX(i + 1);
        idx[io + i + 2] = vo + I.getX(flip ? i : i + 2);
      }
    } else {
      for (let i = 0; i < c.i; i += 3) {
        idx[io + i] = vo + (flip ? i + 2 : i);
        idx[io + i + 1] = vo + i + 1;
        idx[io + i + 2] = vo + (flip ? i : i + 2);
      }
    }
    vo += c.v; io += c.i;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Build the merged rigid skin for a rig, or null if there is nothing to gain.
 *
 * Only meshes that are VISIBLE at the moment of the call go in, which is how
 * the LOD cull is honoured without this file owning a second copy of it: the
 * caller applies `_applyLod` first and this bakes whatever survived.
 */
export function buildMergedSkin(rig, opts = {}) {
  const root = rig.root;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const bones = rig.list.map((b) => b.obj);
  const boneIndex = new Map();
  bones.forEach((o, i) => boneIndex.set(o, i));

  const bins = new Map();
  const replaced = [];
  const refused = new Map();
  let visible = 0;

  const walk = (o, shown) => {
    const on = shown && o.visible;
    if (on && o.isMesh) {
      visible++;
      const why = refuseReason(o);
      const bone = why ? null : ownerBone(o, root);
      if (why || !bone) {
        const r = why || 'rides no bone';
        refused.set(r, (refused.get(r) || 0) + 1);
      } else {
        const key = mergeBinKey(o.material);
        let bin = bins.get(key);
        if (!bin) bins.set(key, (bin = { key, template: o.material, entries: [] }));
        bin.entries.push({ mesh: o, boneIndex: boneIndex.get(bone.obj) ?? 0 });
        replaced.push(o);
      }
    }
    for (const c of o.children) walk(c, on);
  };
  for (const c of root.children) walk(c, true);

  // Nothing to gain is a real answer: a body already down to one mesh a bin
  // pays the bake and the memory for no fewer calls.
  if (!bins.size || replaced.length <= bins.size) return null;

  const skeleton = new THREE.Skeleton(bones);
  const meshes = [];
  for (const bin of bins.values()) {
    const geo = bakeBin(bin.entries, rootInv);
    /* The template's own clone, so everything this file does not understand —
     * a define, a shadowSide, a future field — comes across untouched. Only the
     * three things the bake absorbed are overwritten. */
    const mat = bin.template.clone();
    mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    mat.name = `${bin.template.name || 'skin'}·L2`;
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = 'mergedSkinL2';
    mesh.userData.mergedSkinL2 = true;
    mesh.castShadow = false;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    mesh.visible = false;
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
    meshes.push(mesh);
  }

  return { meshes, replaced, refused, skeleton, from: replaced.length, to: meshes.length, visible };
}

/* ── the rung, as `Enemy._applyLod` uses it ───────────────────────────── */

/** The two counters that say this is no longer the body that was baked. */
function staleness(actor) {
  return actor ? `${actor.severedCount || 0}/${actor.ragdolled ? 1 : 0}` : '0/0';
}

/**
 * ONE BAKE A FRAME, AND THIS IS A MEASUREMENT RATHER THAN A NICETY.
 *
 * A cold bake costs 2.76 ms a body (42 mixed bodies, geonosis, a loaded box).
 * A wave arriving together crosses 62 m together, and 42 of those in one frame
 * is 116 ms — a visible lurch at precisely the moment the player is being
 * charged. Deferred, a body simply draws its LOD-1 set for one more frame,
 * which is the set it was already drawing.
 *
 * The clock is the WORLD's, not `performance.now()`: a paused world must not
 * spend its budget, and the check needs to be able to step the same frame twice
 * and see the same answer. `_budget` is module state on purpose — the cost is
 * the CPU's and there is one of those, not one per World.
 */
const _budget = { at: -1, spent: 0 };
export const BAKES_PER_FRAME = 1;

function mayBake(owner) {
  const now = owner.world?.time ?? 0;
  if (_budget.at !== now) { _budget.at = now; _budget.spent = 0; }
  if (_budget.spent >= BAKES_PER_FRAME) return false;
  _budget.spent++;
  return true;
}

/**
 * Show or hide the merged skin for one body, building it the first time.
 *
 * Returns true when the merged skin is what is drawing. `Enemy._applyLod` is
 * the only caller and owns the LOD comparison; this owns everything else.
 */
export function applyMergedSkin(owner, lod) {
  const rig = owner.rig;
  if (!rig) return false;
  let L = owner._l2;

  const fresh = staleness(owner.actor);
  if (L && L.skin && L.stale !== fresh) { disposeMergedSkin(owner); L = owner._l2 = null; }

  const want = lod === L2_LOD && !owner.actor?.ragdolled && !(owner.actor?.severedCount > 0);

  if (!want) {
    if (L && L.skin && L.on) {
      for (const m of L.skin.meshes) m.visible = false;
      for (const m of L.skin.replaced) m.visible = true;
      L.on = false;
    }
    return false;
  }

  if (!L) {
    if (!mayBake(owner)) return false;
    /* `skin` may come back null — a body with nothing to gain. It is REMEMBERED
     * as null so the walk is not repeated every time that body crosses the
     * boundary. */
    const skin = buildMergedSkin(rig, { receiveShadow: owner.rig.root.children.some((c) => c.receiveShadow) });
    L = owner._l2 = { skin, on: false, stale: fresh };
  }
  if (!L.skin) return false;

  if (!L.on) {
    for (const m of L.skin.replaced) m.visible = false;
    for (const m of L.skin.meshes) m.visible = true;
    L.on = true;
    L.stale = fresh;
  }
  return true;
}

/**
 * Give the merged skin back.
 *
 * `Rig.dispose` walks `rig.root` and frees geometry and material, and the
 * merged meshes are children of it — so a body that is simply removed needs
 * nothing here. This exists for the mid-life teardown a cut forces, where the
 * rig itself lives on.
 */
export function disposeMergedSkin(owner) {
  const L = owner._l2;
  if (!L || !L.skin) { owner._l2 = null; return; }
  for (const m of L.skin.meshes) {
    m.geometry.dispose();
    m.material.dispose();
    m.removeFromParent();
  }
  if (L.on) for (const m of L.skin.replaced) m.visible = true;
  owner._l2 = null;
}
