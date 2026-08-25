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
 *     42 bodies at 161-207 m    cull 1066  →  L2 196  →  L3 38   (5.2× the merge)
 *     168 bodies, same field    cull 4264  →  L2 784  →  L3 39   (20.1×)
 *
 * The first row is `frame-budget.mjs` §7's own reading, and it moves with the
 * field it measures. The second is the same construction at four times the
 * population, and it is the row that says what the rung IS: four times the army
 * is ONE more draw call. The eight cohorts either row fields are eight
 * ARCHETYPES, not eight groups of men.
 *
 * (Both rows said 194→27 and 776→27 until this pass re-measured them, and no
 * check had failed. A figure in a comment is derived from nothing and answerable
 * to nothing, so it goes stale in silence — which is why every claim the rung
 * actually stands on is an assertion in §7, and why none of those assertions
 * quotes a number from up here.)
 *
 * ── THE PLACE IS IN THE MATRIX; THE GAIT IS A PALETTE THE CROWD INDEXES ──
 *
 * WHERE A COHORT GOES is still one 4x4 an instance — position, facing and the
 * body's own scale, rewritten every frame. Bodies march, wheel and close in
 * their instance matrices and nothing about that changed.
 *
 * WHAT POSE IT WEARS used to be one answer for the whole cohort, and that was
 * the rung's one visible cost: a hundred and sixty-eight men in a field, every
 * one of them mid-stride on the same foot, forever. Per BODY the freeze was
 * already honest and `tools/checks/frame-budget.mjs` §7 measures it — at 138 m
 * a 0.86 m leg is 3.9 px and the worst archetype's frozen pose sits 0.98x as
 * far from the live body as the live body sits from itself one gait frame
 * later. What that measurement never looks at is the CROWD: the error is the
 * same error on every body at the same instant, and an eye that cannot resolve
 * one 8 px trooper's shin reads a hundred of them in lockstep immediately.
 *
 * So a cohort now carries a PALETTE of `poseSlots()` poses and every instance
 * indexes it with its own gait phase — one float an instance, written in
 * `place` beside the matrix. The palette is `slots x bones` rigid transforms
 * RELATIVE TO THE FROZEN POSE, so an untouched slot is the identity and an
 * untouched palette is this rung exactly as it shipped.
 *
 * ── WHY A VERTEX SHADER IS NOW ALLOWED, AND WHAT STILL WATCHES IT ────────
 *
 * The first cut of this file refused §14 Step 5's "per-instance phase in the
 * vertex shader" outright, and the argument was right as far as it went: the
 * ink prepass renders with `scene.overrideMaterial = normalMat`, so a vertex
 * displacement living in a body's own material is NOT in the shader the prepass
 * compiles, and a cohort that walked in its own shader would have its OUTLINE
 * drawn at the un-walked pose.
 *
 * What settles it is that the prepass cannot see a cohort at all, and that this
 * is CHECKED rather than assumed. `OutlinePass.prepass` gives its camera a far
 * plane of `min(uHaze.y, uEdge.y) * 1.06`; frame-budget.mjs drives that shipped
 * function over every level and every quality tier and the furthest it ever
 * reaches is 127.2 m, against a band that starts at `L3_AT` = 137.8 m — a gap
 * of 10.6 m. The largest displacement a palette slot actually applies is
 * measured in the same suite and it is 0.19 m on a trooper's walk, fifty times
 * inside that gap; the check asserts the pair rather than the two numbers being
 * quoted at each other. The day somebody moves `INK.edgeFade` far enough to
 * close it, that check fails before a frame is drawn — which is the same
 * tripwire the rung already stood on for its outline.
 *
 * ── WHY NOT A PALETTE OF BAKED COHORTS, WHICH IS THE OBVIOUS ANSWER ──────
 *
 * Give each pose its own frozen geometry and its own `InstancedMesh` and no
 * shader is needed at all — and the rung is gone. The reading in §7 is 42
 * bodies on geonosis costing 196 draw calls merged and 38 instanced; twelve
 * poses is twelve sets of bins, 456 calls, which is worse than not having the
 * rung. Even four poses is 152 against the merge's 196: a 1.3x rung bought with
 * a frozen copy of every archetype in memory, where the shipped one is 5.2x.
 * The count is why this is a texture fetch and not a mesh.
 *
 * ── WHAT A COHORT CANNOT DO ──────────────────────────────────────────────
 *
 * Stated here because it is the part a player could notice, not the draw call:
 *
 *   A POSE OFF ITS OWN CYCLE. The palette is a WALK, captured from cohort
 *   members that are walking, and an instance that is not walking writes -1 and
 *   wears the pose the cohort was frozen in. So a body that kneels, staggers,
 *   is held or is knocked down past the band still stands. `Enemy.crouch` is
 *   the writer that could show; nothing else in the roster changes a standing
 *   body's outline by more than the gait already does.
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
/* READ, never held at module scope. This is one half of a cycle — Enemy.js
 * imports this file — so the binding is in its temporal dead zone while this
 * module evaluates and is live long before any cohort exists. `poseSlots()`
 * therefore reads it at first use. */
import { ANIM_STEP } from './Enemy.js';

const _m = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _yaxis = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _canon = new THREE.Matrix4();
const _pm = new THREE.Matrix4();

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

/**
 * The LOD band this rung owns. It was a literal `3` in `applyCohort` and a
 * literal `3` in `ANIM_STEP`'s table, and the pose palette makes the two the
 * same fact: the rate the animator solves a cohort member at is what decides
 * how many poses there are to hold.
 */
export const L3_LOD = 3;

/**
 * How many poses a cohort's palette holds. DERIVED, not chosen.
 *
 * `ANIM_STEP[L3_LOD]` is the interval the shipped animator re-solves a body at
 * this range on — 1/12 s — and that table's own note calls it "twelve poses a
 * stride, more than a hand animator would draw". Twelve is therefore the number
 * of DISTINCT poses the game can put a body past `L3_AT` into in a second: a
 * palette with more slots stores the same pose twice, and one with fewer throws
 * away a pose `_pose` has already paid for. Move the far tier's solve rate and
 * the palette moves with it.
 *
 * Read at first use rather than at import — see the note on the import.
 */
let _slots = 0;
export function poseSlots() { return (_slots ||= Math.round(1 / ANIM_STEP[L3_LOD])); }

/** One cohort creation a frame. The freeze is the expensive part — see `_budget`. */
export const JOINS_PER_FRAME = 1;
const _budget = { at: -1, spent: 0 };

/** How many instances a cohort starts with; it doubles rather than refusing. */
const START_CAP = 64;

/**
 * How many palette slots the WHOLE FIELD re-reads in a frame.
 *
 * One, for the same reason `JOINS_PER_FRAME` is one and load-bearing for the
 * same claim: a capture is a rig walk plus one matrix product a bone, and it is
 * the only per-frame cost this rung adds that is not already per-instance. If
 * it scaled with the population the rung would be counting bodies again, which
 * is the one thing it exists not to do. At one a frame the eight cohorts a
 * geonosis line fields re-read a slot each at 7.5 Hz — see `step`.
 */
export const CAPTURES_PER_FRAME = 1;

/* ── the freeze ───────────────────────────────────────────────────────── */

/**
 * THE CANONICAL FRAME: undo the body's yaw, put its feet at the origin.
 *
 * One function rather than two copies, because the freeze and every later
 * capture must agree to the bit — a capture read in a frame a hair different
 * from the one the geometry was baked in is a whole-body offset applied to
 * every vertex of every instance wearing that slot.
 */
function canonOf(anchor, facing, out) {
  return out.makeRotationY(-facing)
    .multiply(_mb.makeTranslation(-anchor.x, -anchor.y, -anchor.z));
}

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

    const canon = canonOf(anchor, facing, new THREE.Matrix4());
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
    /* AND THE BONE INDEX, under a name of its own and WITHOUT A COPY — it is
     * the same `BufferAttribute` object the L2 skin is drawing from, so it
     * costs one more binding and not one more buffer. It is what the palette
     * lookup is addressed by: the whole reason a pose is one texture fetch here
     * rather than a re-skin is that `MergedSkin` gives every vertex exactly one
     * bone at weight 1.0. Not called `skinIndex`, because this geometry is NOT
     * skinned and a name three's own `USE_SKINNING` path knows would be an
     * invitation for the two to meet. */
    if (geo.attributes.skinIndex) g.setAttribute('aBone', geo.attributes.skinIndex);
    g.setIndex(geo.index);
    g.computeBoundingSphere();
    out.push({ geometry: g, material: mesh.material.clone() });
  }
  return out;
}

/* ── the palette ──────────────────────────────────────────────────────── */

/**
 * ONE MATRIX FETCH A VERTEX, AND THAT IS THE WHOLE TECHNIQUE.
 *
 * `MergedSkin` gives every vertex exactly one bone at weight 1.0, so a POSE is
 * not a field of displaced vertices — it is `bones` rigid 4x4s, and a cohort's
 * palette of twelve of them is 19 x 12 x 3 = 684 texels for a trooper. The
 * vertex shader reads its bone's row for its instance's slot and multiplies.
 * Three fetches, no blend between slots: the far tier's own solve is a 12 Hz
 * staircase (`ANIM_STEP`), so interpolating between palette slots would be
 * smoothing a signal the game does not have.
 *
 * Stored as three RGBA rows of a 3x4 rather than a quaternion and a translation
 * because a matrix cannot be wrong about a bone that carries scale, and the
 * saving would have been one texel out of 684.
 */
export const POSE_GLSL = {
  pars: `
uniform sampler2D uPoseTex;
uniform vec2 uPoseTexel;
uniform float uPoseSlots;
attribute vec4 aBone;
attribute float aPose;
mat4 cohortPose() {
  float v = ( floor( aPose * uPoseSlots ) + 0.5 ) * uPoseTexel.y;
  float x = aBone.x * 3.0;
  vec4 r0 = texture2D( uPoseTex, vec2( ( x + 0.5 ) * uPoseTexel.x, v ) );
  vec4 r1 = texture2D( uPoseTex, vec2( ( x + 1.5 ) * uPoseTexel.x, v ) );
  vec4 r2 = texture2D( uPoseTex, vec2( ( x + 2.5 ) * uPoseTexel.x, v ) );
  return mat4( r0.x, r1.x, r2.x, 0.0,
               r0.y, r1.y, r2.y, 0.0,
               r0.z, r1.z, r2.z, 0.0,
               r0.w, r1.w, r2.w, 1.0 );
}
`,
  /* THE NORMAL FIRST, and it has to be here rather than beside the position:
   * `<defaultnormal_vertex>` consumes `objectNormal` BEFORE `<begin_vertex>`
   * runs, so a rotation applied down there would light the body at the pose it
   * is not in. `cohortPoseM` is declared here and used there — both chunks are
   * inlined into the same `main`, so the matrix is fetched once. */
  normal: `
  mat4 cohortPoseM = aPose < 0.0 ? mat4( 1.0 ) : cohortPose();
  objectNormal = mat3( cohortPoseM ) * objectNormal;
`,
  vertex: `
  transformed = ( cohortPoseM * vec4( transformed, 1.0 ) ).xyz;
`,
};

/**
 * The shipped vertex shader with the palette lookup in it.
 *
 * THROWS rather than returning the shader unchanged, and that is deliberate: a
 * three upgrade that renames one of these chunks would otherwise ship a cohort
 * that silently stopped animating and nothing would say so. `frame-budget.mjs`
 * calls this against `THREE.ShaderLib.physical.vertexShader`, so the throw lands
 * in the gate rather than on a player's screen.
 */
export function posedVertexShader(src) {
  let out = src;
  for (const [hook, add] of [
    ['#include <common>', POSE_GLSL.pars],
    ['#include <beginnormal_vertex>', POSE_GLSL.normal],
    ['#include <begin_vertex>', POSE_GLSL.vertex],
  ]) {
    if (out.indexOf(hook) < 0) {
      throw new Error(`Cohorts: no \`${hook}\` in this vertex shader — three moved the chunk `
        + 'the cohort pose hangs off, so the palette would be built and never read');
    }
    out = out.replace(hook, `${hook}\n${add}`);
  }
  return out;
}

/**
 * Installed on the cohort's OWN material clone, never on the L2 skin's.
 *
 * `this` is the material three is compiling for. The palette hangs off a plain
 * property and NOT off `userData`, which is where this codebase otherwise puts
 * things: `Material.copy` round-trips `userData` through `JSON.stringify`, and
 * this object holds a `DataTexture` over a Float32Array. A clone would either
 * throw or quietly serialise the palette as a megabyte of numbers. Off
 * `userData` a clone simply does not carry it, `poseCompile` returns, and the
 * clone draws the frozen pose — which is a rung, not a crash.
 *
 * Every cohort material shares this one function, so they share ONE compiled
 * program (three keys the cache on `onBeforeCompile.toString()`) while each
 * keeps its own uniforms.
 */
function poseCompile(shader) {
  const P = this.cohortPose;
  if (!P) return;
  shader.uniforms.uPoseTex = { value: P.tex };
  shader.uniforms.uPoseTexel = { value: P.texel };
  shader.uniforms.uPoseSlots = { value: P.slots };
  shader.vertexShader = posedVertexShader(shader.vertexShader);
}

/** Which palette slot a gait phase indexes. The writer and the shader agree. */
export function poseSlotOf(phase, slots) {
  const p = phase - Math.floor(phase);
  return Math.min(slots - 1, (p * slots) | 0);
}

/**
 * THE READER FOR THE SHADER'S WRITER: the transform an instance wearing `phase`
 * applies to a vertex on bone `bone`.
 *
 * `cohortPose()` in `POSE_GLSL` addresses the same texels with the same two
 * terms — `floor( aPose * uPoseSlots )` and `aBone.x * 3.0` — and this is the
 * only way anything without a GL context can read what a cohort is DRAWN as.
 * `frame-budget.mjs` holds the pair together: it rasterises through this and
 * fails if either term leaves the shader, because a check measuring its own
 * copy of the arithmetic is the defect tools/checks/_glsl.mjs exists over.
 *
 * A phase below zero is a body that is not walking, and it wears the identity —
 * i.e. the pose the cohort was frozen in.
 */
export function poseMatrix(c, phase, bone, out) {
  const P = c && c.pose;
  if (!P || !(phase >= 0)) return out.identity();
  const d = P.data, o = (poseSlotOf(phase, P.slots) * P.W + bone * 3) * 4;
  return out.set(d[o], d[o + 1], d[o + 2], d[o + 3],
    d[o + 4], d[o + 5], d[o + 6], d[o + 7],
    d[o + 8], d[o + 9], d[o + 10], d[o + 11], 0, 0, 0, 1);
}

/**
 * A cohort's palette: `slots` poses x `bones` rigid transforms, in the same
 * canonical frame the frozen geometry lives in and expressed RELATIVE to the
 * pose it was frozen in.
 *
 * Relative is the whole safety property. `M[b] = canon_now . W_now[b] .
 * (canon_frozen . W_frozen[b])^-1`, and the bone inverses and the bind matrix
 * cancel out of that product by construction — so the palette cannot disagree
 * with the freeze about the rest pose, and a slot nobody has captured yet is
 * the IDENTITY, which is this rung exactly as it shipped.
 */
function makePalette(skeleton, anchor, facing) {
  const bones = skeleton.bones;
  const B = bones.length;
  const slots = poseSlots();
  const W = B * 3;
  const data = new Float32Array(W * slots * 4);
  for (let s = 0; s < slots; s++) {
    for (let b = 0; b < B; b++) {
      const o = (s * W + b * 3) * 4;
      data[o] = 1; data[o + 5] = 1; data[o + 10] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, slots, THREE.RGBAFormat, THREE.FloatType);
  /* NEAREST both ways and no mipmaps: these texels are matrix rows, and a
   * filtered matrix row is a matrix nobody authored. The slot the shader wants
   * is picked by arithmetic, not by the sampler. */
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  canonOf(anchor, facing, _canon);
  const inv = bones.map((bone) => new THREE.Matrix4()
    .multiplyMatrices(_canon, bone.matrixWorld).invert());
  /* The names, not the bones. A capture reads the DONOR'S OWN skeleton — see
   * `capture` — and the only thing this side has to be sure of is that the
   * donor's bone `b` is the same bone the frozen geometry's `aBone` = b means. */
  return {
    names: bones.map((bone) => bone.name), B, slots, W, data, tex, inv,
    texel: new THREE.Vector2(1 / W, 1 / slots),
    seen: new Uint8Array(slots), filled: 0,
  };
}

/**
 * AN EMPTY SLOT WEARS ITS NEAREST NEIGHBOUR, never the identity.
 *
 * A palette fills from live donors, so which slot gets written next is the
 * crowd's business and not this file's, and a cohort three captures old has
 * nine slots nobody has reached. Leaving those at the identity would draw a
 * crowd in which some men walk and some are frozen mid-stride — a worse artefact
 * than the lockstep this replaces, and one that appears and disappears. So an
 * uncaptured slot mirrors the captured slot nearest it round the cycle: the
 * crowd starts uniform (which is exactly today), gains poses as the captures
 * land, and is never a mixture of animated and frozen bodies.
 */
function mirrorUnseen(P) {
  if (P.filled === 0 || P.filled === P.slots) return;
  const span = P.W * 4;
  for (let j = 0; j < P.slots; j++) {
    if (P.seen[j]) continue;
    let best = -1, bestD = P.slots;
    for (let k = 0; k < P.slots; k++) {
      if (!P.seen[k]) continue;
      const d = Math.min((k - j + P.slots) % P.slots, (j - k + P.slots) % P.slots);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0) P.data.copyWithin(j * span, best * span, best * span + span);
  }
}

/**
 * Write one donor's current pose into the slot its own gait phase indexes.
 *
 * THE DONOR'S OWN BONES, and this is the one thing in the file that is easy to
 * get silently wrong. The first cut read the palette's founding skeleton for
 * every donor, so a capture from a man standing three metres away came out as a
 * three-metre translation applied to every instance wearing that slot — the
 * canonical frame was taken from one body and the pose from another. The bones
 * come off `_l2.skin.skeleton`, which is where `aBone` was numbered from.
 *
 * The two skeletons are interchangeable and that is a property of the cohort
 * KEY rather than a hope: `keyFor` bins on archetype, elite modifier and body
 * scale, and measured across eight troopers of one key every bone's rest offset
 * is identical to the last decimal except `hips`, which carries the body's world
 * position and is exactly what `canonOf` takes back out. The names are compared
 * anyway, because a rig that stopped being determined by the key would
 * otherwise put one man's elbow on another man's arm.
 *
 * The donor must also be WALKING — `animator.moving` is the gait's own
 * predicate, read rather than restated — because the palette is a walk cycle and
 * a standing man captured into it would put a slice of parade rest in the middle
 * of a stride for every instance whose phase happened to land there.
 */
function capture(P, e) {
  const an = e?.animator;
  if (!an || !an.moving || !e.rig) return false;
  const bones = e._l2?.skin?.skeleton?.bones;
  if (!bones || bones.length !== P.B) return false;
  for (let b = 0; b < P.B; b++) if (bones[b].name !== P.names[b]) return false;
  /* The rig walks only if something has posed it since the last walk — see the
   * note over `Rig.updateMatrices`. At LOD 3 that is twelve times a second, so
   * this is a real walk on about one capture in five and free on the rest. */
  e.rig.ensureMatrices();
  canonOf(e.position, e.facing, _canon);
  const slot = poseSlotOf(an.phase, P.slots);
  for (let b = 0; b < P.B; b++) {
    _pm.multiplyMatrices(_canon, bones[b].matrixWorld).multiply(P.inv[b]);
    const m = _pm.elements, o = (slot * P.W + b * 3) * 4;
    P.data[o] = m[0]; P.data[o + 1] = m[4]; P.data[o + 2] = m[8]; P.data[o + 3] = m[12];
    P.data[o + 4] = m[1]; P.data[o + 5] = m[5]; P.data[o + 6] = m[9]; P.data[o + 7] = m[13];
    P.data[o + 8] = m[2]; P.data[o + 9] = m[6]; P.data[o + 10] = m[10]; P.data[o + 11] = m[14];
  }
  if (!P.seen[slot]) { P.seen[slot] = 1; P.filled++; }
  mirrorUnseen(P);
  P.tex.needsUpdate = true;
  return true;
}

/* ── the field ────────────────────────────────────────────────────────── */

export class CohortField {
  constructor(scene) {
    this.scene = scene;
    this.cohorts = new Map();
    this.joins = 0;
    this.refused = new Map();
    /* Whose turn it is to re-read a palette slot, and whose turn it is to be
     * read. Both rotate — see `step`. */
    this.turn = 0;
    this._live = [];
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
    /* AND THE BONES ARE WALKED FIRST, unconditionally. `freezeSkin` bakes the
     * pose out of `bone.matrixWorld`, and past LOD 1 the gait defers its walk
     * (see the note over `Rig.updateMatrices`) — a cohort baked from unwalked
     * bones would wear whatever pose the body was in the last time somebody
     * asked, frozen for as long as that cohort lives. */
    e.rig.updateMatrices();
    for (const m of skin.meshes) m.updateMatrixWorld(true);

    const parts = freezeSkin(skin, e.position, e.facing);
    /* NO BONE INDEX, NO PALETTE, and the cohort is the frozen rung it always
     * was. `MergedSkin` always writes `skinIndex`, so this is the door for a
     * skin that came from somewhere else rather than a case that happens. */
    const pose = skin.skeleton && parts.every((x) => x.geometry.attributes.aBone)
      ? makePalette(skin.skeleton, e.position, e.facing) : null;
    const meshes = parts.map(({ geometry, material }) => {
      if (pose) { material.cohortPose = pose; material.onBeforeCompile = poseCompile; }
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
    c = { key, meshes, cap: START_CAP, high: 0, free: [], members: new Set(), pose, aPose: null, donor: 0 };
    if (pose) this._sizePhases(c, START_CAP);
    this.cohorts.set(key, c);
    return c;
  }

  /**
   * The per-instance gait phase, on every bin's geometry.
   *
   * ONE attribute object shared by all four bins, because a cohort's bins are
   * one body cut up by material and an instance is the same man in each of
   * them — two arrays would be two chances to disagree about which pose he is
   * in. Filled with -1, which is "not walking, wear the frozen pose": a slot
   * that has been allocated but not yet placed is then the rung as it shipped
   * rather than a body in pose zero.
   */
  _sizePhases(c, cap) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(-1), 1);
    a.setUsage(THREE.DynamicDrawUsage);
    if (c.aPose) a.array.set(c.aPose.array);
    c.aPose = a;
    for (const im of c.meshes) im.geometry.setAttribute('aPose', a);
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
    /* AFTER the meshes are replaced, not during: `_sizePhases` writes the
     * attribute onto every bin's geometry, and the geometry is the object the
     * old and the new InstancedMesh share. */
    if (c.pose) this._sizePhases(c, cap);
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
    /* …AND THE GAIT PHASE, which is the whole of the per-instance animation and
     * costs one float a body a frame however many bodies there are. `moving` is
     * the gait's own predicate; a body that is not walking writes -1 and wears
     * the pose the cohort was frozen in, which is where this rung started. */
    const A = L.c.aPose;
    if (A) {
      const an = e.animator;
      A.array[L.slot] = an && an.moving ? an.phase - Math.floor(an.phase) : -1;
      A.needsUpdate = true;
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
   * RE-READ ONE PALETTE SLOT. Called once a frame by `World.update`, after the
   * bodies have posed and placed themselves, which is the frame's freshest rig.
   *
   * BOTH ROTATIONS MATTER and they are doing different jobs. The COHORT rotates
   * so the cost is `CAPTURES_PER_FRAME` and not one-per-cohort — that is the
   * flat-in-population claim. The DONOR rotates within the cohort because the
   * members are spread across the cycle by `Enemy._animPhase` already: a
   * palette fed by one body fills at that body's own drift round the ring,
   * which on a steady march can alias onto a handful of slots for seconds,
   * while one fed by all of them fills at the crowd's spread. Same cost either
   * way — one donor is read per capture.
   */
  step() {
    const live = this._live;
    live.length = 0;
    for (const c of this.cohorts.values()) if (c && c.pose && c.members.size) live.push(c);
    if (!live.length) return 0;
    let taken = 0;
    for (let i = 0; i < CAPTURES_PER_FRAME; i++) {
      const c = live[this.turn++ % live.length];
      const k = c.donor++ % c.members.size;
      let j = 0, donor = null;
      for (const m of c.members) { if (j++ === k) { donor = m; break; } }
      if (capture(c.pose, donor)) taken++;
    }
    return taken;
  }

  /**
   * HOW MANY DIFFERENT POSES THE FIELD IS DRAWING, and over how many bodies.
   *
   * The number the rung was missing, and the only one that says whether the
   * palette is doing anything: `stats().calls` was already flat and `worn` was
   * already one per live cohort BY CONSTRUCTION, whatever the population. Kept
   * out of `stats()` because it walks every member and `stats()` is read on
   * frames a check is not running.
   */
  poseStats() {
    let instances = 0, slots = 0, filled = 0, worn = 0, frozen = 0;
    for (const c of this.cohorts.values()) {
      if (!c || !c.members.size) continue;
      instances += c.members.size;
      if (!c.pose) { frozen += c.members.size; continue; }
      slots += c.pose.slots; filled += c.pose.filled;
      const seen = new Set();
      for (const e of c.members) {
        const ph = c.aPose.array[e._l3.slot];
        if (ph < 0) frozen++; else seen.add(poseSlotOf(ph, c.pose.slots));
      }
      worn += seen.size;
    }
    return { instances, slots, filled, worn, frozen };
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
      c.pose?.tex.dispose();
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
  const fit = lod >= L3_LOD && !!owner.rig && !owner.dead
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
