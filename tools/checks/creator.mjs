/**
 * The character creator — species, face and frame, in src/game/Bodies.js.
 *
 * Three things make this worth its own file rather than three more cases in
 * body-parts.mjs.
 *
 * THE DEFAULT MUST NOT MOVE. `buildJedi` is called from Player, Enemy, Net and
 * the menu preview, and every one of those calls it with no species, no face
 * and no build. Every parameter added here is therefore written so that its
 * neutral value is the arithmetic identity — `x * (1 + gain*0)` and
 * `x + gain*0` — and the checks below pin that the neutral triple, the neutral
 * preset id and the neutral raw object all produce the same floats as passing
 * nothing at all. This was verified against the previous commit vertex buffer
 * by vertex buffer while the feature was written; what survives here is the
 * property that keeps it true.
 *
 * A SPECIES IS A BUDGET PROBLEM. characters.mjs caps an archetype at 13 000
 * triangles and 76 meshes and the Jedi measures 12 924 in 66. There is no room
 * for a species; there is only the room the human hair takes up, which is 732
 * triangles in 2 meshes. Every species below is measured against exactly that.
 *
 * AND A FACE HAS TO READ AT GAMEPLAY RANGE. At 8 m through a 60° vertical FOV
 * on a 1080-line frame one pixel is 8.55 mm and a head is 24 pixels tall, so a
 * "wider jaw" worth 4 mm is half a pixel and a mouth is nothing at all. The
 * checks here rasterise the figure at exactly that density with the engine's
 * own light rig and compare pixels, because the alternative — asserting that
 * the geometry moved — passes happily for changes no player can see.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import {
  buildJedi, SPECIES, FACE_PRESETS, BODY_TYPES, BUILD_RANGE, tubeGeo, surfacePoint,
} from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';
import { Actor } from '../../src/game/Ragdoll.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';

/* ── the figure, standing ────────────────────────────────────────────── */

const CACHE = new Map();
/** One built, posed, matrix-updated figure — building is not cheap. */
function unit(opts = {}) {
  const key = JSON.stringify(opts);
  if (CACHE.has(key)) return CACHE.get(key);
  const built = buildJedi(opts);
  const anim = new BipedAnimator(built.rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    anim.update(1 / 60, { position: p, facing: 0, velocity: v, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
  }
  anim.swingArms(1 / 60, 0, 1);
  built.rig.updateMatrices();
  built.rig.root.updateMatrixWorld(true);
  CACHE.set(key, built);
  return built;
}

/* ── a software frame at the density the game is played at ───────────── */

// src/engine/Engine.js _setupLights(): sun 0xfff0d8 at 3.6, a hemisphere fill
// 0xbcd8ff over 0x60482e at 0.30, and a cool directional fill at 0.45 from
// (-1, 0.6, -0.8). Reproduced rather than approximated, because the whole point
// of the exercise is whether a shading difference survives THIS rig.
const SUN = { d: new THREE.Vector3(-0.42, 0.78, 0.46).normalize(), c: [1.0, 0.941, 0.847], i: 3.6 };
const FILL = { d: new THREE.Vector3(-1, 0.6, -0.8).normalize(), c: [0.624, 0.769, 1.0], i: 0.45 };
const SKY = [0.737, 0.847, 1.0], GND = [0.376, 0.282, 0.180], HEMI = 0.30;
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Rasterise a subtree into a luminance buffer and a coverage mask.
 *
 * The vertical FOV is the game's own 60° and the frame is 1080 lines, so
 * `mpp` — 8.55 mm at 8 m — is the number every judgement in this file is made
 * against. Materials contribute the albedo they were AUTHORED as (see lit() and
 * note() in Bodies.js: `color` is pre-divided by the bake's mean, so the tint
 * typed is what reaches the frame) times the vertex-colour occlusion channel,
 * which is where a brow ridge and a cheekbone actually live.
 */
function frame(root, o = {}) {
  const H = o.H || 1080, W = o.W || 560, dist = o.dist ?? 8, yaw = o.yaw ?? 0;
  const at = o.at || new THREE.Vector3(0, 1.58, 0);
  const cam = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
  cam.position.set(at.x + Math.sin(yaw) * dist, at.y, at.z + Math.cos(yaw) * dist);
  cam.lookAt(at);
  cam.updateMatrixWorld(true);
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const lum = new Float32Array(W * H), mask = new Uint8Array(W * H);
  const depth = new Float32Array(W * H).fill(Infinity);
  const vs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ns = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nm = new THREE.Matrix3(), cp = new THREE.Vector4();

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position || obj.visible === false) return;
    const g = obj.geometry, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    if (!N) return;
    const idx = g.index, n = idx ? idx.count : P.count;
    nm.getNormalMatrix(obj.matrixWorld);
    const m = obj.material;
    const alb = (m && m.userData && m.userData.authored) || (m && m.color ? [m.color.r, m.color.g, m.color.b] : [0.6, 0.6, 0.6]);
    const vc = !!(m && m.vertexColors && C);
    const em = m && m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : null;
    for (let i = 0; i + 2 < n; i += 3) {
      const I = [idx ? idx.getX(i) : i, idx ? idx.getX(i + 1) : i + 1, idx ? idx.getX(i + 2) : i + 2];
      const sx = [], sy = [], sz = [], sl = [];
      let ok = true;
      for (let j = 0; j < 3; j++) {
        vs[j].fromBufferAttribute(P, I[j]).applyMatrix4(obj.matrixWorld);
        ns[j].fromBufferAttribute(N, I[j]).applyMatrix3(nm).normalize();
        cp.set(vs[j].x, vs[j].y, vs[j].z, 1).applyMatrix4(VP);
        if (cp.w <= 0.01) { ok = false; break; }
        sx.push((cp.x / cp.w * 0.5 + 0.5) * W);
        sy.push((0.5 - cp.y / cp.w * 0.5) * H);
        sz.push(vs[j].distanceTo(cam.position));
        const nn = ns[j], k = vc ? C.getX(I[j]) : 1;
        const nd = Math.max(0, nn.dot(SUN.d)) * SUN.i, fd = Math.max(0, nn.dot(FILL.d)) * FILL.i;
        const hm = 0.5 + 0.5 * nn.y;
        let L = 0;
        const wgt = [0.2126, 0.7152, 0.0722];
        for (let ch = 0; ch < 3; ch++) {
          const lit = nd * SUN.c[ch] + fd * FILL.c[ch] + HEMI * (hm * SKY[ch] + (1 - hm) * GND[ch]);
          const v = alb[ch] * k * lit * 0.955 + (em ? em[ch] : 0);
          L += wgt[ch] * srgb(v / (1 + v));
        }
        sl.push(L);
      }
      if (!ok) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...sx))), x1 = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy))), y1 = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      const det = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(det) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / det;
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2], k = y * W + x;
        if (z >= depth[k]) continue;
        depth[k] = z;
        lum[k] = w0 * sl[0] + w1 * sl[1] + w2 * sl[2];
        mask[k] = 1;
      }
    }
  });
  return { lum, mask, W, H, mpp: 2 * dist * Math.tan(Math.PI / 6) / H };
}

/** A pixel window `halfM` metres either side of the frame centre. */
function window0(f, halfM, tall = 1.3) {
  const h = Math.ceil(halfM / f.mpp);
  return [Math.round(f.W / 2 - h), Math.round(f.H / 2 - h * tall),
    Math.round(f.W / 2 + h), Math.round(f.H / 2 + h * tall)];
}

/**
 * How different two frames are over a window.
 *
 * `xor` is silhouette: pixels one covers and the other does not. `over2`/`over5`
 * count INTERIOR pixels — not within one pixel of either mask's edge — whose
 * luminance differs by more than 2% or 5%. Excluding the edge matters: a
 * silhouette that moves half a pixel produces an enormous luminance delta at
 * the boundary that has nothing to do with whether the shading changed, and
 * counting it would let a face preset pass on the strength of an outline the
 * xor term has already measured.
 */
function diff(a, b, win) {
  const [x0, y0, x1, y1] = win, W = a.W;
  const edge = (m, x, y) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!m[(y + j) * W + (x + i)]) return true;
    return false;
  };
  let xor = 0, n = 0, over2 = 0, over5 = 0, sum = 0, peak = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = y * W + x;
    if (a.mask[k] !== b.mask[k]) xor++;
    if (!a.mask[k] || !b.mask[k]) continue;
    if (edge(a.mask, x, y) || edge(b.mask, x, y)) continue;
    const d = Math.abs(a.lum[k] - b.lum[k]);
    n++; sum += d; peak = Math.max(peak, d);
    if (d > 0.02) over2++;
    if (d > 0.05) over5++;
  }
  return { xor, n, over2, over5, mean: n ? sum / n : 0, peak };
}

const covered = (f, win) => {
  let n = 0;
  for (let y = win[1]; y <= win[3]; y++) for (let x = win[0]; x <= win[2]; x++) if (f.mask[y * f.W + x]) n++;
  return n;
};

/* ── geometry helpers ────────────────────────────────────────────────── */

/** Every mesh's vertex data as one comparable digest. */
function digest(built) {
  const rows = [];
  built.rig.root.updateMatrixWorld(true);
  built.rig.root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const parts = [];
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.attributes[name];
      parts.push(name + ':' + (a ? a.array.length : 0));
      if (a) {
        // a checksum, not a hash: two figures that differ anywhere differ here,
        // and the position term is order- and sign-sensitive.
        let s = 0, t = 0;
        for (let i = 0; i < a.array.length; i++) { s += a.array[i] * (i % 7 + 1); t += Math.abs(a.array[i]) * i; }
        parts.push(s.toFixed(9) + '/' + t.toFixed(9));
      }
    }
    if (g.index) {
      let s = 0;
      for (let i = 0; i < g.index.count; i++) s += g.index.getX(i) * (i % 5 + 1);
      parts.push('i' + s);
    }
    parts.push(o.matrixWorld.elements.map(v => v.toFixed(9)).join(','));
    const m = o.material;
    parts.push(m ? `${m.type}|${m.color ? m.color.getHexString() : ''}|${m.roughness}|${m.metalness}` : '');
    rows.push(parts.join(' '));
  });
  return rows.sort().join('\n');
}

const cost = (root) => {
  let t = 0, m = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    m++;
    t += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  return { tris: Math.round(t), meshes: m };
};

/** World-space triangles of a subtree. */
function soup(root, out = []) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, P = g.attributes.position, idx = g.index, n = idx ? idx.count : P.count;
    for (let i = 0; i + 2 < n; i += 3) {
      out.push([0, 1, 2].map(j =>
        new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(i + j) : i + j).applyMatrix4(o.matrixWorld)));
    }
  });
  return out;
}

const _RAY = new THREE.Vector3(0.3711, 0.8123, 0.4491).normalize();
/** Ray-parity point-in-mesh, over a triangle soup. */
function inside(tris, p) {
  let hits = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), q = new THREE.Vector3(), tv = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.subVectors(b, a); e2.subVectors(c, a); q.crossVectors(_RAY, e2);
    const det = e1.dot(q);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    tv.subVectors(p, a);
    const u = tv.dot(q) * inv;
    if (u < 0 || u > 1) continue;
    q.crossVectors(tv, e1);
    const v = _RAY.dot(q) * inv;
    if (v < 0 || u + v > 1) continue;
    if (e2.dot(q) * inv > 1e-7) hits++;
  }
  return (hits & 1) === 1;
}

/** The species' own head geometry: the merged meshes that are not the shell. */
function speciesParts(built) {
  const head = built.rig.get('head');
  const out = [];
  /**
   * 0.10 m WAS the threshold, and it was a length on a human head.
   *
   * A species may now be a different SIZE (SPECIES[].frame), and a 0.66 m
   * figure's whole head is 16 cm tall — so an absolute 100 mm floor does not
   * separate "a lek" from "a stud" on it, it excludes everything and reports
   * that the row put nothing on its head. Measured against the head SHELL's own
   * span instead, which is what the sentence meant all along: a species part is
   * a thing of the same order as the head it is on, not a detail.
   */
  head.primary.geometry.computeBoundingBox();
  const span = head.primary.geometry.boundingBox.getSize(new THREE.Vector3()).length();
  for (const o of head.obj.children) {
    if (!o.isMesh || o === head.primary) continue;
    const b = new THREE.Box3().setFromObject(o);
    if (b.getSize(new THREE.Vector3()).length() > span * 0.30) out.push(o);
  }
  return out;
}

export async function run({ check, assert, near }) {
  /* Rapier, because `a head severed at the neck` drives the real Ragdoll and a
   * RapierWorld throws without it. It used to rely on some earlier suite having
   * called this — true in a full run, false when the file runs on its own, so
   * the check passed or threw depending on what came before it in a directory
   * listing. Same class as the seeded RNG in held.mjs. */
  await initPhysics();

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the contract                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('creator: the three axes are exported in the shape the menu builds against', () => {
    // The menu is written against these names in a parallel workstream, so the
    // shape is a contract and not an implementation detail. Every id has to be
    // unique (a duplicate silently makes one card unselectable) and every
    // default has to resolve, because an unknown id falls back to entry zero
    // and a player would just see the wrong species with no error anywhere.
    for (const [what, list] of [['SPECIES', SPECIES], ['BODY_TYPES', BODY_TYPES], ['FACE_PRESETS', FACE_PRESETS]]) {
      assert(Array.isArray(list) && list.length >= 4, `${what} has only ${list && list.length} entries`);
      const ids = new Set(list.map(e => e.id));
      assert(ids.size === list.length, `${what} has a duplicate id`);
      for (const e of list) {
        assert(typeof e.id === 'string' && e.id, `${what} has an entry with no id`);
        assert(typeof e.name === 'string' && e.name, `${what}.${e.id} has no display name`);
      }
    }
    assert(Array.isArray(BUILD_RANGE) && BUILD_RANGE.length === 2 && BUILD_RANGE[0] < BUILD_RANGE[1],
      'BUILD_RANGE is not a [min, max] pair');
    assert(SPECIES[0].id === 'human', 'the first species is not the human default');
    // Per-species tone rows. Every species needs one — the menu's human row is
    // beige and a beige Twi'lek is not a Twi'lek — and the entries have to be
    // real choices rather than a gradient of one idea, which is the same bar
    // appearance.mjs holds the human palette to.
    for (const sp of SPECIES) {
      assert(Array.isArray(sp.skinTones) && sp.skinTones.length >= 6,
        `${sp.id} offers ${sp.skinTones ? sp.skinTones.length : 0} skin tones`);
      for (const t of sp.skinTones) assert(typeof t.hex === 'number' && typeof t.name === 'string',
        `${sp.id} has a malformed skin tone`);
      assert(new Set(sp.skinTones.map(t => t.hex)).size === sp.skinTones.length,
        `${sp.id} has a duplicated skin tone`);
      let closest = 1e9, pair = '';
      for (let i = 0; i < sp.skinTones.length; i++) for (let j = i + 1; j < sp.skinTones.length; j++) {
        const a = sp.skinTones[i].hex, b = sp.skinTones[j].hex;
        const d = Math.hypot((a >> 16 & 255) - (b >> 16 & 255), (a >> 8 & 255) - (b >> 8 & 255), (a & 255) - (b & 255));
        if (d < closest) { closest = d; pair = `${sp.skinTones[i].name}/${sp.skinTones[j].name}`; }
      }
      assert(closest > 18, `${sp.id}'s ${pair} are the same colour twice (${closest.toFixed(0)} apart in RGB)`);
      assert(typeof sp.skin === 'number', `${sp.id} has no default skin colour to fall back on`);
    }
    // and the whole set has to actually build
    for (const sp of SPECIES) assert(buildJedi({ species: sp.id }).rig, `${sp.id} did not build`);
    for (const f of FACE_PRESETS) assert(buildJedi({ face: f.id }).rig, `face ${f.id} did not build`);
    for (const b of BODY_TYPES) assert(buildJedi({ build: b.id }).rig, `build ${b.id} did not build`);
    return `${SPECIES.length} species, ${FACE_PRESETS.length} faces, a frame slider over [${BUILD_RANGE}] with ${BODY_TYPES.length} named stops`;
  });

  check('creator: the neutral choice is the figure that shipped, to the last float', () => {
    // THE ONE THAT PROTECTS EVERYTHING ELSE. Player, Enemy, Net and the menu
    // preview all call buildJedi with no species, no face and no build, and the
    // whole design of this feature is that their figure did not move: every
    // parameter enters as `x * (1 + gain*p)` or `x + gain*p`, and `x * 1` and
    // `x + 0` are exact in IEEE float.
    //
    // Verified against the previous commit vertex buffer by vertex buffer when
    // the feature was written. What is pinned here is the property that keeps
    // it true — that saying "human", "even" and 0.5 out loud, in any of the
    // three spellings the builder accepts, is the same as saying nothing.
    const base = digest(unit({}));
    const same = {
      'the explicit neutral triple': { species: 'human', face: 'even', build: 0.5 },
      'a raw empty face object': { face: {} },
      'the named neutral body type': { build: 'even' },
      'an unknown species id': { species: 'no-such-species' },
      'an out-of-range face value': { face: { jaw: 0, brow: 0 } },
      'a non-finite build': { build: NaN },
    };
    for (const [why, opts] of Object.entries(same)) {
      assert(digest(unit(opts)) === base, `${why} changed the default figure`);
    }
    // ...and the same holds for the argument shape the real callers use, not
    // only for the empty one: Player and the menu preview pass a robe index, a
    // skin colour, a hair colour and a scale, and adding the neutral triple to
    // THAT call has to be a no-op too.
    const dressed = { robeIndex: 1, skinColor: 0xf0cdb4, hairColor: 0x2a1d14, scale: 1 };
    assert(digest(unit(dressed)) === digest(unit({ ...dressed, species: 'human', face: 'even', build: 0.5 })),
      'adding the neutral species, face and build to a real Player call changed the figure');
    // and every single parameter's neutral has to be a no-op ON ITS OWN, or a
    // gain that is not zero-centred hides behind the others being zero
    for (const key of ['skull', 'brow', 'cheek', 'jaw', 'chin', 'nose', 'eyes', 'mouth']) {
      assert(digest(unit({ face: { [key]: 0 } })) === base, `face.${key} = 0 is not the identity`);
    }
    // ...and the axes must actually DO something, or the above is vacuous
    let moved = 0;
    for (const key of ['skull', 'brow', 'cheek', 'jaw', 'chin', 'nose', 'eyes', 'mouth']) {
      if (digest(unit({ face: { [key]: 1 } })) !== base) moved++;
    }
    assert(moved === 8, `only ${moved} of the 8 face parameters change the figure at all`);
    assert(digest(unit({ build: 0 })) !== base && digest(unit({ build: 1 })) !== base,
      'the frame slider does nothing');
    for (const sp of SPECIES.slice(1)) {
      assert(digest(unit({ species: sp.id })) !== base, `${sp.id} builds the human figure`);
    }
    return `the default is untouched by 6 spellings of "neutral" and by 8 zeroed parameters; all 8 parameters, the slider and ${SPECIES.length - 1} species move it`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  species                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('creator: a species pays for itself out of the hair it does not have', () => {
    // 12 924 triangles of 13 000, 66 meshes of 76. There is no headroom for a
    // species — there is only the human hair, which is 732 triangles in 2
    // meshes, and every species here spends that and no more. Measured at both
    // ends of the frame slider and across every face preset, because a check
    // that only ever builds the default is how a budget gets blown.
    const rows = [];
    let worstT = 0, worstM = 0, worstAt = '';
    for (const sp of SPECIES) {
      let hi = { tris: 0, meshes: 0 };
      for (const build of [0, 0.5, 1]) for (const face of FACE_PRESETS) {
        const c = cost(unit({ species: sp.id, build, face: face.id }).rig.root);
        if (c.tris > hi.tris) hi = c;
      }
      assert(hi.tris < 13000, `${sp.id} is ${hi.tris} triangles against a 13000 cap`);
      assert(hi.meshes < 76, `${sp.id} is ${hi.meshes} meshes — ${hi.meshes * 2} draw calls with shadows`);
      if (hi.tris > worstT) { worstT = hi.tris; worstM = hi.meshes; worstAt = sp.id; }
      rows.push(`${sp.id} ${hi.tris}/${hi.meshes}`);
    }
    const human = cost(unit({}).rig.root);
    // the real constraint, stated as the constraint: nothing costs more than
    // the figure it replaces
    for (const sp of SPECIES.slice(1)) {
      const c = cost(unit({ species: sp.id }).rig.root);
      assert(c.tris <= human.tris, `${sp.id} costs ${c.tris - human.tris} triangles MORE than the human it replaces`);
      assert(c.meshes <= human.meshes, `${sp.id} costs ${c.meshes - human.meshes} meshes more than the human`);
      // and it has to have spent the allowance on something
      const parts = speciesParts(unit({ species: sp.id }));
      assert(parts.length >= 1, `${sp.id} put nothing on its head`);
    }
    return rows.join(' ') + ` — worst ${worstAt} ${worstT}/${worstM} of 13000/76`;
  });

  check('creator: a species is a different shape, not a different tint', () => {
    // The two species that were CUT are the argument for this check. Mirialan
    // is a human with green skin and 8 mm facial tattoos, and Chiss is a human
    // with blue skin and a red iris; at 8.55 mm per pixel both of them are a
    // recoloured human, and a list of eight species four of which are the same
    // head is worse than a list of five that are not.
    //
    // Measured head-on and at three quarters over the head and shoulders,
    // which is the band a player reads a face in. The bar is the SILHOUETTE
    // alone — a species that needed its skin colour to be told apart would not
    // pass, which is exactly the property being defended.
    const rows = [];
    let worst = 1e9, worstPair = '', win = null, cov = 0;
    for (const yaw of [0, 0.5]) {
      const shots = {};
      for (const sp of SPECIES) {
        shots[sp.id] = frame(unit({ species: sp.id }).rig.root, { yaw, at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
      }
      win = window0(shots.human, 0.26);
      cov = covered(shots.human, win);
      for (const A of SPECIES) for (const B of SPECIES) {
        if (A.id >= B.id) continue;
        const d = diff(shots[A.id], shots[B.id], win);
        if (d.xor < worst) { worst = d.xor; worstPair = `${A.id}/${B.id}`; }
      }
      if (yaw === 0) {
        for (const sp of SPECIES.slice(1)) {
          rows.push(`${sp.id} ${diff(shots.human, shots[sp.id], win).xor}`);
        }
      }
    }
    // 40 px on an 1861-pixel head and shoulders. The pair that sets it is
    // Kel Dor against Zabrak, whose distinguishing features — a mask and a
    // crown of horns — do not compete for the same part of the outline, so
    // this number is a floor on "two bald heads seen from an angle" and not on
    // whether either of them reads.
    assert(worst > 40, `${worstPair} differ by only ${worst} silhouette pixels at 8 m`);
    return `head+shoulders covers ${cov} px at 8 m; vs human ${rows.join(', ')}; closest pair ${worstPair} ${worst} px`;
  });

  check('creator: nothing a species hangs on a head passes through the body under it', () => {
    // Lekku, montrals and head tentacles are RIGID and parented to the head
    // bone, which is the honest cost of not owning Cloth.js this pass: they
    // track the head's yaw, and Player clamps that glance to ±0.85 rad, so the
    // tip of a 42 cm lek travels 30 cm sideways.
    //
    // Every path in SPECIES_HEADS was fitted against this measurement rather
    // than drawn — the first attempt put 40 of a Togruta's 194 head-tail
    // vertices inside its own chest, and 17 of a Twi'lek's 116 inside its back.
    const rows = [];
    for (const sp of SPECIES) {
      const built = unit({ species: sp.id });
      const rig = built.rig, head = rig.get('head');
      const torso = [];
      for (const name of ['chest', 'spine', 'hips']) {
        for (const o of rig.get(name).obj.children) {
          if (!o.userData.boneChild) soup(o, torso);
        }
      }
      let worst = 0, worstYaw = 0, total = 0;
      const restQ = head.obj.quaternion.clone();
      for (let i = -4; i <= 4; i++) {
        const yaw = i * 0.2125;
        head.obj.quaternion.copy(head.restQuat)
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')));
        rig.updateMatrices();
        rig.root.updateMatrixWorld(true);
        let n = 0;
        for (const o of speciesParts(built)) {
          const P = o.geometry.attributes.position, v = new THREE.Vector3();
          for (let j = 0; j < P.count; j++) {
            v.fromBufferAttribute(P, j).applyMatrix4(o.matrixWorld);
            if (i === 0) total++;
            if (inside(torso, v)) n++;
          }
        }
        if (n > worst) { worst = n; worstYaw = yaw; }
      }
      head.obj.quaternion.copy(restQ);
      rig.updateMatrices();
      rig.root.updateMatrixWorld(true);
      assert(worst === 0,
        `${sp.id}: ${worst} of ${total} head-part vertices are inside the torso at a head yaw of ${worstYaw.toFixed(2)} rad`);
      rows.push(`${sp.id} ${total}`);
    }
    return `clear at every glance in ±0.85 rad — ${rows.join(', ')} vertices checked`;
  });

  check('creator: a head severed at the neck takes its species with it', () => {
    // This game cuts heads off, and it does it while first person has set
    // `visible = false` on every mesh under the neck. Ragdoll.addBone() re-homes
    // the DIRECT children of the bone it is moving and makes each one visible
    // again — so anything a species adds has to be a direct child of the head
    // object, and anything one level down inside a positioning Group is hidden
    // by the first mechanism and missed by the second.
    //
    // That is not hypothetical: the human's hair braid was a mesh inside a
    // Group, and 13 of a severed head's 14 meshes came back visible. It is a
    // direct child now.
    const rows = [];
    for (const sp of SPECIES) {
      const built = buildJedi({ species: sp.id });
      const head = built.rig.get('head');
      const before = [];
      head.obj.traverse((o) => { if (o.isMesh) before.push(o); });
      assert(before.length >= 4, `${sp.id} has only ${before.length} meshes on its head`);
      // first person, mid-duel: every mesh under the neck is hidden
      head.obj.traverse((o) => { if (o.isMesh) o.visible = false; });

      const scene = new THREE.Scene();
      const world = new RapierWorld({ gravity: -22 });
      const actor = new Actor(scene, world, built.rig, { scale: 1 });
      const cut = actor.cut('neck', 0.5, new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 1.5, 0));
      assert(cut, `${sp.id}: the neck did not sever at all`);
      const piece = actor.pieces[0];
      assert(piece, `${sp.id}: nothing came away`);

      const arrived = new Set();
      let hidden = 0;
      for (const e of piece.entries) {
        e.holder.traverse((o) => {
          if (!o.isMesh) return;
          arrived.add(o);
          if (!o.visible) hidden++;
        });
      }
      for (const m of before) {
        assert(arrived.has(m), `${sp.id}: a ${m.geometry.index ? m.geometry.index.count / 3 : 0}-triangle piece of the head stayed behind`);
      }
      assert(hidden === 0,
        `${sp.id}: ${hidden} of the severed head's ${arrived.size} meshes came away still hidden by first person`);
      // and nothing may be left hanging on the rig, which is now a corpse with
      // no head on it
      let left = 0;
      built.rig.root.traverse((o) => { if (o.isMesh && before.includes(o)) left++; });
      assert(left === 0, `${sp.id}: ${left} head meshes are still parented to the body`);
      rows.push(`${sp.id} ${before.length}→${arrived.size}`);
    }
    return rows.join(' ') + ' meshes, all visible, none left behind';
  });

  check('creator: a bald species is bald, not wearing a black skullcap', () => {
    // The head shell's occlusion bake drives everything above the ear line and
    // behind the hairline down to 0.28, because the hair is seven low-poly
    // shells over a low-poly braincase and a poke-through has to read as a dark
    // root rather than as bare bone. Applied to a species with no hair on it,
    // that same term paints the top two thirds of a bare skull at a quarter
    // brightness — a black cap, which is what the first pass shipped.
    const rows = [];
    for (const sp of SPECIES) {
      const built = unit({ species: sp.id });
      const shell = built.rig.get('head').primary.geometry;
      const C = shell.attributes.color, P = shell.attributes.position;
      /**
       * The crown window, in units of the SKULL rather than in metres.
       *
       * 0.135 and 0.02 are a human skull's ear line and brow plane, and a
       * species that declares its own frame does not have them there — on a
       * 0.66 m figure the whole head fits below 0.135 and the window sampled
       * zero vertices, which passed the `n > 12` guard straight into a failure
       * that had nothing to do with the bake. Taken off the shell's own box,
       * the same fractions land on the same part of any head.
       */
      shell.computeBoundingBox();
      const sb = shell.boundingBox;
      const yLine = sb.min.y + (sb.max.y - sb.min.y) * 0.734;
      const zLine = sb.min.z + (sb.max.z - sb.min.z) * 0.630;
      let sum = 0, n = 0;
      for (let i = 0; i < C.count; i++) {
        // the crown: above the ear line, behind the brow
        if (P.getY(i) < yLine || P.getZ(i) > zLine) continue;
        sum += C.getX(i); n++;
      }
      assert(n > 12, `${sp.id}: only ${n} crown vertices sampled`);
      const mean = sum / n;
      if (sp.hair === false) {
        assert(mean > 0.80, `${sp.id} has no hair and its crown is baked at ${mean.toFixed(2)} — that is a skullcap`);
      } else {
        assert(mean < 0.45, `the human crown is baked at ${mean.toFixed(2)}, so a hair poke-through would show as bare bone`);
      }
      rows.push(`${sp.id} ${mean.toFixed(2)}`);
    }
    return rows.join(' ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  face                                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('creator: face presets are still faces at the range the game is played at', () => {
    // A preset that only reads in a 300-pixel menu preview is a settings screen,
    // not a character creator. At 8 m a head is 24 pixels tall, so the presets
    // are built out of the only two things that survive that: the OUTLINE of
    // the cranium and jaw, and the large shading masses — brow, cheekbone,
    // socket — which move the mean luminance of a five-pixel patch.
    const rows = [];
    let worst = 1e9, worstPair = '', cov = 0;
    for (const yaw of [0, 0.5]) {
      const shots = {};
      for (const f of FACE_PRESETS) shots[f.id] = frame(unit({ face: f.id }).rig.root, { yaw, dist: 8 });
      const win = window0(shots.even, 0.15);
      cov = covered(shots.even, win);
      for (const A of FACE_PRESETS) for (const B of FACE_PRESETS) {
        if (A.id >= B.id) continue;
        const d = diff(shots[A.id], shots[B.id], win);
        // one score, both channels: pixels of outline moved plus pixels whose
        // shading moved by more than 5%
        const score = d.xor + d.over5;
        if (score < worst) { worst = score; worstPair = `${A.id}/${B.id} (${d.xor} px outline + ${d.over5} px shading)`; }
      }
      if (yaw === 0) for (const f of FACE_PRESETS) {
        if (f.id === 'even') continue;
        const d = diff(shots.even, shots[f.id], win);
        rows.push(`${f.id} ${d.xor}+${d.over5}`);
      }
    }
    assert(worst > 30, `the two closest face presets differ by ${worstPair} — that is the same face twice`);
    return `head covers ${cov} px at 8 m; vs even ${rows.join(', ')}; closest pair ${worstPair}`;
  });

  check('creator: what a face parameter buys at 8 m is measured, not assumed', () => {
    // The honest table, and it is not the one that was expected. Each parameter
    // swung -1 → +1 on its own, at the real sampling density, head-on, over the
    // ~515 interior pixels of a head at 8 m:
    //
    //   param   outline px   px past 2%   px past 5%
    //   skull       94          105           58
    //   jaw          9          117           91
    //   cheek        1           66           50
    //   chin         1           58           45
    //   brow         0           57           45
    //   nose         0           52           42
    //   eyes         0           16           15
    //   mouth        0            0            0
    //
    // EXACTLY ONE FACE PARAMETER CHANGES THE OUTLINE, and it is not the jaw.
    // The reason is worth writing down: on this figure the hair is wider than
    // the mandible from every angle, so a jaw swung ±13 mm never reaches the
    // silhouette at all — it is entirely a shading feature, and the 117 pixels
    // it moves are the jaw's own shadow and the crease under it. `skull` is the
    // outline parameter only because the hair was made to follow the vault;
    // against a fixed cap it was worth two pixels.
    //
    // Both halves are pinned. The six that carry the presets have to keep
    // carrying them, and the two that are preview-range features have to STAY
    // small — the failure this prevents is someone "fixing" a mouth that does
    // not read at 8 m by making it 6 cm wide, which would read at 8 m and would
    // also be a clown.
    const K = ['skull', 'brow', 'cheek', 'jaw', 'chin', 'nose', 'eyes', 'mouth'];
    const rows = [], got = {};
    for (const key of K) {
      const a = frame(unit({ face: { [key]: 1 } }).rig.root, { dist: 8 });
      const b = frame(unit({ face: { [key]: -1 } }).rig.root, { dist: 8 });
      const d = diff(a, b, window0(a, 0.15));
      got[key] = d;
      rows.push(`${key} ${d.xor}px/${d.over2}`);
    }
    // the six that must read at gameplay range, at the level each was measured at
    for (const [key, floor] of [['jaw', 85], ['cheek', 45], ['chin', 40], ['brow', 40], ['nose', 35]]) {
      assert(got[key].over2 >= floor,
        `${key} moves ${got[key].xor} outline pixels and only ${got[key].over2} shaded ones at 8 m (was ${floor}) — it has stopped reading in play`);
    }
    assert(got.skull.xor >= 55,
      `skull moves only ${got.skull.xor} outline pixels: the hair is not following the vault, so the head's own outline never changes`);
    // and the two that are preview features stay preview features
    for (const key of ['eyes', 'mouth']) {
      assert(got[key].xor < 12 && got[key].over2 < 40,
        `${key} now moves ${got[key].xor} outline and ${got[key].over2} shaded pixels at 8 m — that is not a ${key}, that is a deformity`);
    }
    // and they still have to do something in the preview, or they are dead knobs
    for (const key of ['eyes', 'mouth']) {
      const near0 = frame(unit({ face: { [key]: 1 } }).rig.root, { dist: 0.7, H: 900, W: 700 });
      const near1 = frame(unit({ face: { [key]: -1 } }).rig.root, { dist: 0.7, H: 900, W: 700 });
      const d = diff(near0, near1, [40, 40, 660, 860]);
      assert(d.xor + d.over2 > 60, `${key} is invisible in the preview too (${d.xor} px outline, ${d.over2} shaded)`);
    }
    return rows.join(' ');
  });

  check('creator: no face preset buries a feature inside the head it belongs to', () => {
    // tools/verify.mjs pins this for the default face; every preset moves the
    // brow, the cheekbones and the jaw, and the eyes, lashes, brows and lips
    // are all seated by raycasting the assembled skull — so a preset that moved
    // a mass without moving the probe origin would seat a feature five
    // centimetres inside the face, which is the bug this file's neighbours have
    // caught four separate times.
    const rows = [];
    for (const f of FACE_PRESETS) {
      const built = unit({ face: f.id });
      const head = built.rig.get('head');
      const meshes = [];
      head.obj.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
      const shell = [...meshes].sort((a, b) =>
        b.geometry.attributes.position.count - a.geometry.attributes.position.count).slice(0, 2);
      const tris = [];
      for (const m of shell) soup(m, tris);
      let worst = 1;
      for (const m of meshes) {
        if (shell.includes(m)) continue;
        const b = new THREE.Box3().setFromObject(m);
        const cz = (b.min.z + b.max.z) / 2;
        if (cz < 0.03) continue;                 // ears and hair sit behind by design
        const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
        // the frontmost surface of the shell at this feature's own x and y
        let sz = -Infinity;
        const o = new THREE.Vector3(cx, cy, -0.4), d = new THREE.Vector3(0, 0, 1);
        for (const [p, q, r] of tris) {
          const e1 = new THREE.Vector3().subVectors(q, p), e2 = new THREE.Vector3().subVectors(r, p);
          const h = new THREE.Vector3().crossVectors(d, e2), det = e1.dot(h);
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, tv = new THREE.Vector3().subVectors(o, p);
          const u = tv.dot(h) * inv;
          if (u < 0 || u > 1) continue;
          const qq = new THREE.Vector3().crossVectors(tv, e1);
          const v = d.dot(qq) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = e2.dot(qq) * inv;
          if (t > 0) sz = Math.max(sz, o.z + t);
        }
        if (!isFinite(sz)) continue;
        worst = Math.min(worst, b.max.z - sz);
      }
      assert(worst > -0.0005, `face preset "${f.id}" leaves a feature ${(-worst * 1000).toFixed(1)}mm inside the head shell`);
      rows.push(`${f.id} ${(worst * 1000).toFixed(1)}mm`);
    }
    return rows.join(' ') + ' clearance';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  frame                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('creator: the frame slider changes the body, not the tint', () => {
    // One number drives eleven radii, the torso's depth, the deltoid and the
    // trapezius. What has to come out the other end is a figure that is a
    // different SHAPE from across an arena, not a differently-proportioned
    // sketch that reads the same at any range a player fights at.
    const a = unit({ build: 0 }), b = unit({ build: 1 }), mid = unit({});
    const R = (u, bone) => {
      const m = u.rig.get(bone).primary, g = m.geometry, P = g.attributes.position;
      let r = 0;
      for (let i = 0; i < P.count; i++) r = Math.max(r, Math.hypot(P.getX(i) * m.scale.x, P.getZ(i) * m.scale.z));
      return r;
    };
    // shoulder-to-hip and waist-to-hip: the two ratios a frame IS in outline
    const sh = (u) => R(u, 'chest') / R(u, 'hips');
    const wh = (u) => R(u, 'spine') / R(u, 'hips');
    assert(sh(b) > sh(a) * 1.10, `shoulder-to-hip only moves ${sh(a).toFixed(3)} → ${sh(b).toFixed(3)} across the slider`);
    assert(wh(b) > wh(a) * 1.10, `waist-to-hip only moves ${wh(a).toFixed(3)} → ${wh(b).toFixed(3)}`);
    // and the neck, which the collar frames and which is the cue that survives
    assert(R(b, 'neck') > R(a, 'neck') * 1.15, 'the neck does not change thickness');
    // now the thing that actually matters: pixels, at two ranges
    const out = [];
    for (const dist of [8, 30]) {
      const at = new THREE.Vector3(0, 0.95, 0);
      const fa = frame(a.rig.root, { dist, at, W: 640 });
      const fb = frame(b.rig.root, { dist, at, W: 640 });
      const fm = frame(mid.rig.root, { dist, at, W: 640 });
      const win = [0, 0, fa.W - 1, fa.H - 1];
      const d = diff(fa, fb, win);
      const area = Math.max(covered(fa, win), covered(fb, win));
      const frac = d.xor / area;
      assert(frac > 0.05, `at ${dist} m the two ends of the slider share ${(100 - frac * 100).toFixed(1)}% of one silhouette`);
      // and the middle has to sit between them rather than beside one
      const dm0 = diff(fm, fa, win).xor, dm1 = diff(fm, fb, win).xor;
      assert(dm0 > d.xor * 0.2 && dm1 > d.xor * 0.2,
        `at ${dist} m the default frame is indistinguishable from one end (${dm0}/${dm1} against ${d.xor})`);
      out.push(`${dist}m ${d.xor}px = ${(frac * 100).toFixed(1)}% of the figure (default sits ${dm0}/${dm1})`);
    }
    return `shoulder/hip ${sh(a).toFixed(2)}→${sh(b).toFixed(2)}, waist/hip ${wh(a).toFixed(2)}→${wh(b).toFixed(2)}; ` + out.join(', ');
  });

  check('creator: every garment still fits the body across the whole frame slider', () => {
    // The tabards raycast the ribcage and look after themselves. The collar,
    // the obi, the belt, both skirts, the boot shafts and the whole
    // sleeve-hem-cuff-bracer stack are lathes at TYPED radii, and a typed
    // radius on a torso that just grew 15% is a bracer inside its own forearm.
    //
    // Measured as: for every garment on a limb, the fraction of its vertices
    // that lie inside that limb's own surface at the same height and bearing.
    // Some burial is correct — the trapezius is 76% inside the ribcage it
    // blends into by design — so the assertion is not on the fraction but on
    // how much WORSE the fraction gets at either end of the slider than it is
    // in the middle. Two of these were real: the tunic's V went from 27% inside
    // to 65% at the heavy end, and the obi from 20% to 31% before it was moved
    // onto the waist's multiplier instead of the pelvis's.
    const measure = (build) => {
      const built = unit({ build });
      const rows = [];
      for (const bone of built.rig.list) {
        const limb = bone.primary;
        if (!limb || !limb.userData.limb) continue;
        const lg = limb.geometry, sx = limb.scale.x || 1, sy = limb.scale.y || 1, sz = limb.scale.z || 1;
        for (const o of bone.obj.children) {
          if (!o.isMesh || o === limb || o.userData.boneChild) continue;
          const P = o.geometry.attributes.position;
          const v = new THREE.Vector3(), d = new THREE.Vector3(), org = new THREE.Vector3(), hit = new THREE.Vector3();
          let n = 0, tot = 0;
          for (let i = 0; i < P.count; i++) {
            v.fromBufferAttribute(P, i).applyMatrix4(o.matrix);
            const r = Math.hypot(v.x, v.z);
            if (r < 1e-5 || v.y < 0.002 || v.y > bone.length - 0.002) continue;
            d.set(v.x / sx, 0, v.z / sz).normalize();
            org.set(0, v.y / sy, 0);
            const p = surfacePoint(lg, d, org, hit, true);
            if (!p) continue;
            tot++;
            if (r < Math.hypot(p.x * sx, p.z * sz)) n++;
          }
          if (tot > 8) rows.push({ bone: bone.name, tris: Math.round(o.geometry.index ? o.geometry.index.count / 3 : 0), f: n / tot });
        }
      }
      return rows;
    };
    const lo = measure(0), mid = measure(0.5), hi = measure(1);
    assert(lo.length === mid.length && hi.length === mid.length,
      `the frame slider changes the NUMBER of garments (${lo.length}/${mid.length}/${hi.length})`);
    assert(mid.length >= 30, `only ${mid.length} garments were measured`);
    let worst = 0, at = '';
    for (let i = 0; i < mid.length; i++) {
      const d = Math.max(lo[i].f - mid[i].f, hi[i].f - mid[i].f);
      if (d > worst) { worst = d; at = `${mid[i].bone}'s ${mid[i].tris}-triangle garment`; }
    }
    assert(worst < 0.15,
      `${at} is ${(worst * 100).toFixed(0)}% more buried at an end of the frame slider than in the middle`);
    // nothing may vanish outright at either end
    for (const set of [['slight', lo], ['heavy', hi]]) {
      for (const g of set[1]) {
        assert(g.f < 0.90, `on the ${set[0]} frame, a ${g.tris}-triangle garment on the ${g.bone} is ${(g.f * 100).toFixed(0)}% inside the limb`);
      }
    }
    return `${mid.length} garments on limbs; worst extra burial at an extreme ${(worst * 100).toFixed(1)}% (${at})`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the primitive the species are built out of                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('creator: a swept tube is closed, outward-facing and cheap', () => {
    // Every lek, montral, tentacle and horn is one of these, and all three
    // properties have bitten this codebase before in other shapes. A tube wound
    // the wrong way is lit from the inside; an open one shows the sky through a
    // severed head; and clawGeo — the thing this replaces — merges one CAPPED
    // limbGeo per segment, so a six-segment tail carries five pairs of end caps
    // buried inside itself and costs three times what it needs to.
    const nodes = [];
    for (let i = 0; i < 7; i++) nodes.push([Math.sin(i * 0.3) * 0.05, -i * 0.05, -i * 0.02, 0.04 - i * 0.005]);
    const g = tubeGeo(nodes, 8);
    const P = g.attributes.position, N = g.attributes.normal, I = g.index;
    const tris = I.count / 3;
    assert(tris === 112, `a 7-node 8-segment tube is ${tris} triangles, not 112`);
    // closed: every edge belongs to exactly two triangles
    const edges = new Map();
    for (let i = 0; i < I.count; i += 3) {
      const a = I.getX(i), b = I.getX(i + 1), c = I.getX(i + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const k = u < v ? `${u}_${v}` : `${v}_${u}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    let open = 0;
    for (const v of edges.values()) if (v !== 2) open++;
    assert(open === 0, `${open} of ${edges.size} edges are not shared by exactly two triangles`);
    // outward: the signed volume of a correctly wound closed mesh is positive
    let vol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), x = new THREE.Vector3();
    for (let i = 0; i < I.count; i += 3) {
      a.fromBufferAttribute(P, I.getX(i)); b.fromBufferAttribute(P, I.getX(i + 1)); c.fromBufferAttribute(P, I.getX(i + 2));
      vol += a.dot(x.crossVectors(b, c)) / 6;
    }
    assert(vol > 0, `the tube's signed volume is ${vol.toExponential(2)} — it is wound inside out`);
    // and no seam: a duplicated seam column would leave two coincident vertices
    // with different normals, which is a lighting crease down the whole length
    let seams = 0;
    for (let i = 0; i < P.count; i++) for (let j = i + 1; j < P.count; j++) {
      if (Math.abs(P.getX(i) - P.getX(j)) < 1e-9 && Math.abs(P.getY(i) - P.getY(j)) < 1e-9
        && Math.abs(P.getZ(i) - P.getZ(j)) < 1e-9) seams++;
    }
    assert(seams === 0, `${seams} coincident vertex pairs — that is a seam, and a seam is a crease`);
    // every normal unit, and the side wall facing away from the axis
    let bad = 0;
    for (let i = 0; i < N.count; i++) {
      if (Math.abs(Math.hypot(N.getX(i), N.getY(i), N.getZ(i)) - 1) > 1e-4) bad++;
    }
    assert(bad === 0, `${bad} normals are not unit length`);
    // and it must carry the vertex-colour channel, or a species part on the
    // skin material (which declares vertexColors) renders BLACK
    assert(g.attributes.color, 'tubeGeo emits no colour attribute — a lek would render black');
    return `112 triangles, ${edges.size} edges all shared, volume ${vol.toExponential(2)}, no seam, ${P.count} vertices`;
  });
}
