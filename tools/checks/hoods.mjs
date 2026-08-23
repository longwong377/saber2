/**
 * BATTLEFRONT BORZ — hoods.
 *
 * The player, in their own words:
 *
 *   *"I want hoods, wearable hoods that go over your head, a few different
 *    kinds, they should look really cool"*
 *
 * and, from the round before it:
 *
 *   *"you should be able to wear different kinds of hoods that go over your
 *    head and look cool, there are no hoods in the game right now"*
 *
 * The second sentence was exactly true. There were TWO hoods in the whole
 * build — the Sentinel's cowl and the acolyte's — and both were an inline
 * sphere segment with a torus on it, typed out separately in two places, worn
 * by enemies, and reachable by a player through nothing at all. The character
 * creator had nine wardrobe rows and none of them touched the head. And
 * src/game/Cloth.js had already written down why, in the long note over
 * WARDROBE: *"AND THE ONE THING THIS FILE CANNOT FAKE AT ALL: a HOOD… A hood
 * is a second, smaller sheet pinned in a RING round the neck, and it needs the
 * head bone and a collision hull for the skull; the machinery is all here but
 * the anchor belongs to whoever owns the head."*
 *
 * So four cuts now live in src/game/Bodies.js as rigid geometry — `HOOD_CUTS`,
 * `hoodOn`, `attachHood` — a tenth row went into the creator, `wardrobeOf`
 * normalises the id, and `Player` and the wardrobe seam in ui/Menu.js both put
 * one on a body.
 *
 * ── WHAT THESE CHECKS ARE FOR ────────────────────────────────────────────
 *
 * Not "a hood mesh exists". Every failure this feature can actually have is a
 * MEASUREMENT, and each of the six below is one that a mesh-exists assertion
 * would sail straight past:
 *
 *   IT IS ON THE WRONG PARENT. `Actor.addBone` re-homes exactly the children
 *   of a bone object and `Actor.goRagdoll` re-homes them onto that bone's
 *   holder, so a hood parented to `rig.root` is orphaned the moment a body
 *   falls — it would stand in the air over the corpse, and it would stay on
 *   the shoulders when the head was cut off. Enemy.js states the same rule for
 *   the health bar. Nothing about the mesh looks wrong; only where it ends up
 *   after the body is destroyed does, so that is what is measured.
 *
 *   IT DOES NOT ACTUALLY COVER ANYTHING. A cowl authored a centimetre too
 *   small, or with its opening rotated onto one ear (three puts phi = 0 at -X,
 *   which is the trap both shipped cowls were written around), still builds,
 *   still renders, and leaves a bare skull showing through the cloth. So the
 *   cranium is ray-tested against the hood, vertex by vertex.
 *
 *   IT BLINDS THE FIGURE. The opposite failure and the more expensive one: a
 *   hood pulled far enough forward to cover the head covers the FACE, and the
 *   creator's whole preview is a portrait. Measured at `theta: 0.44`, the
 *   desert cap's front edge sat at y 0.087 and took 9.8% of the eye band with
 *   it. It is 0.42 and 0.0% now, and this check is why.
 *
 *   THE FOUR ARE ONE HOOD WITH THE SLIDERS MOVED. This is the failure the
 *   roster had — four Jedi at 0.939 flank IoU, "a Knight with three
 *   centimetres more hilt" — and a wardrobe row is more prone to it than an
 *   archetype is, because every entry starts as a copy of the one above. So
 *   the four are rasterised against each other exactly as `characters.mjs`
 *   rasterises the roster, and against a bare head as well: a hood that does
 *   not change the outline is not a hood, it is a hat badge.
 *
 *   FIRST PERSON LEAVES IT FLOATING. `Player._applyViewMode` hides the head by
 *   traversing the NECK, which reaches every mesh under the head bone — so a
 *   hood on the right parent is hidden for free and a hood anywhere else is a
 *   cowl hanging in the middle of the screen. That is a consequence and not a
 *   line of code, which is exactly the kind of thing that quietly stops being
 *   true, so it is measured on a real Player through the shipped method.
 *
 *   IT COSTS TOO MUCH. `Enemy._applyLod`'s note: "twenty of them on screen at
 *   once is over a thousand draw calls before the shadow pass doubles it". A
 *   hood built as a shell plus a rim plus a peak plus three gathered folds
 *   plus a nape drape is six meshes if nobody is counting. Every cut goes
 *   through one Kit bucket and comes out as ONE, and the budget is stated and
 *   enforced below.
 *
 * ── THE NUMBERS, as measured the day this was written ────────────────────
 *
 *     cut     tris   crown+nape covered   eye band blocked   lining
 *     cowl     896        85.0 %               0.0 %          0.42
 *     sith    1028        88.8 %               0.0 %          0.34
 *     wrap     900       100.0 %               0.0 %          0.46
 *     cloak   1280        82.5 %               0.0 %          0.30
 *
 * and the worst-matched pair of the four shares 0.791 of one head outline,
 * against the roster's own bar of 0.89 for whole bodies at range.
 *
 * A bare Jedi is 64 meshes and a hooded one is 65. The Sentinel — whose cowl
 * moved into `HOOD_CUTS.cowl` unchanged, so the rank stopped carrying its own
 * copy of the geometry — went from 66 to 65, because the shell and its rim
 * used to be two meshes and are now one.
 */

import * as THREE from 'three';
import { buildJedi, HOOD_CUTS, hoodCut, attachHood, surfacePoint,
         JEDI_RANKS } from '../../src/game/Bodies.js';
import { attachHoodDrape } from '../../src/game/Cloth.js';
import { WARDROBE, wardrobeOf } from '../../src/game/Cloth.js';
import { DEFAULT_SETTINGS, applyWardrobe } from '../../src/ui/Menu.js';
import { Player } from '../../src/game/Player.js';
import { Actor } from '../../src/game/Ragdoll.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { initPhysics } from '../../src/physics/Rapier.js';
import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';

/** The four cuts that are cloth. `none` is the absence of one and is checked apart. */
const WORN = HOOD_CUTS.filter((h) => !h.none);

/* ── the bench ───────────────────────────────────────────────────────── */

/**
 * A figure in one hood, plus the handles every check below wants.
 *
 * `face: { hair: 'temple' }` is stated rather than left to the default so the
 * silhouette comparison is measuring the HOOD and not a hairstyle: `sheetOf`
 * already resolves to the temple cut with no argument, but a check whose
 * result depends on a default it does not name is a check that changes
 * meaning the day somebody moves the default.
 */
function wearing(id, opts = {}) {
  const built = buildJedi({ scale: 1, hood: id, face: { hair: 'temple' }, ...opts });
  built.rig.updateMatrices();
  const head = built.rig.get('head');
  const hoods = head.obj.children.filter((c) => c.isMesh && c.userData.hood);
  return { built, rig: built.rig, head, hoods, mesh: hoods[0] || null };
}

/** Every mesh anywhere in a rig — the draw-call count of one body. */
function meshCount(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

/**
 * A point inside the braincase, in the head bone's own frame.
 *
 * Every ray below is fired FROM here rather than from the bone's origin, which
 * is at the base of the skull: a ray from the origin to a vertex on the crown
 * runs nearly parallel to the surface it is supposed to be testing, and grazing
 * rays are where a triangle test's tolerance lives. Measured on the shipped
 * head, the skull spans y -0.034 to 0.197 and z -0.118 to 0.101, so this is
 * roughly its centroid.
 */
const CORE = new THREE.Vector3(0, 0.086, -0.010);

/**
 * How much of the skull a hood is actually outside of.
 *
 * For each distinct skull vertex in a region, fire a ray from CORE through it
 * and ask whether the hood's far surface lies beyond the skull's. That is the
 * definition of "the cloth is over this piece of head" and it needs no
 * projection, no camera and no threshold on distance.
 *
 * TWO REGIONS, and the split is the whole content of the measurement:
 *
 *   `crown`  y >= 0.10 and z <= 0.02 — the cranium from the brow line up and
 *            from the ear line back. Nothing about a hood is optional here:
 *            every one of the four has to cover it. The forehead is NOT in it,
 *            because a cowl's opening is a wedge that legitimately runs from
 *            the crown down to the nose, and a region that included it would
 *            be measuring the opening rather than the cover.
 *
 *   `eyes`   the band y 0.030-0.090, z > 0.055, |x| <= 0.050 — the nose, the
 *            mouth and the inner corners of both eyes. Nothing may cover it.
 *            The eye whites sit at y 0.074-0.094 and the brows at 0.099-0.107,
 *            so a cut is free to come down onto the brow (the desert wrap
 *            does, deliberately) and is not free to come down past it.
 */
function coverage(head, hoodGeo) {
  const skull = head.primary.geometry;
  const p = skull.attributes.position;
  const v = new THREE.Vector3(), d = new THREE.Vector3(), hit = new THREE.Vector3();
  const seen = new Set();
  let crownN = 0, crownHit = 0, eyeN = 0, eyeHit = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // The lathe duplicates its seam column and the assembled skull welds
    // nothing, so the same point arrives several times; counting it once keeps
    // the percentage a percentage of the SURFACE rather than of the buffer.
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    d.subVectors(v, CORE);
    const ds = d.length();
    if (ds < 1e-4) continue;
    d.divideScalar(ds);
    let covered = false;
    if (hoodGeo) {
      const h = surfacePoint(hoodGeo, d, CORE, hit, true);
      // 1 mm of slack: a hood whose cloth is exactly ON the skull is inside it
      // as far as a player is concerned, and floats depend on the vertex order
      // of two unrelated meshes.
      covered = !!h && h.distanceTo(CORE) > ds + 0.001;
    }
    if (v.y >= 0.10 && v.z <= 0.02) { crownN++; if (covered) crownHit++; }
    if (v.y > 0.030 && v.y < 0.090 && v.z > 0.055 && Math.abs(v.x) <= 0.050) {
      eyeN++; if (covered) eyeHit++;
    }
  }
  return { crown: crownN ? crownHit / crownN : 0, crownN,
           eyes: eyeN ? eyeHit / eyeN : 0, eyeN };
}

/**
 * Rasterise the HEAD's outline in the head bone's own frame — a 60 cm window
 * centred 9 cm above the bone, so two cuts are compared at the same
 * millimetres per pixel and a bigger hood is bigger rather than renormalised.
 *
 * Same scanline fill as tools/checks/characters.mjs's `silhouette`, and
 * deliberately: that function is what the roster's "no two archetypes share an
 * outline" bar is measured with, so a hood row measured the same way can be
 * read against the same numbers. It is reproduced rather than imported because
 * that one rasterises a whole body into a WORLD frame with the feet on the
 * bottom edge, which is the wrong window for a 30 cm object on a bone.
 */
function outline(head, axis, W = 128, H = 128, half = 0.30, cy = 0.09) {
  const inv = new THREE.Matrix4().copy(head.obj.matrixWorld).invert();
  const bits = new Uint8Array(W * H);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const u = axis === 'z' ? 'x' : 'z';
  head.obj.traverse((o) => {
    if (!o.isMesh || o.visible === false || !o.geometry?.attributes?.position) return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(M);
      b.fromBufferAttribute(p, i1).applyMatrix4(M);
      c.fromBufferAttribute(p, i2).applyMatrix4(M);
      const P = [a, b, c].map((q) => [((q[u] + half) / (2 * half)) * (W - 1),
        ((cy + half - q.y) / (2 * half)) * (H - 1)]);
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
  return bits;
}

const iou = (p, q) => {
  let i = 0, u = 0;
  for (let k = 0; k < p.length; k++) { if (p[k] || q[k]) u++; if (p[k] && q[k]) i++; }
  return u ? i / u : 0;
};

/**
 * The smallest world a Player will build in.
 *
 * Copied in shape from tools/checks/first-person.mjs's, minus everything
 * `update` needs, because nothing here steps a frame: these checks construct a
 * body, call the shipped `_applyViewMode`, and read what is visible.
 */
function stubWorld(hood) {
  return {
    scene: new THREE.Scene(),
    settings: { ...DEFAULT_SETTINGS, wardrobe: { ...WARDROBE, hood } },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, players: [],
  };
}

/**
 * How many vertices of VISIBLE geometry sit within 35 cm of the head bone.
 *
 * The number nobody guesses right: it is 569 on a bare figure in first person
 * and it is not zero, because `_anchorViewArms` puts both forearms and both
 * gloves onto the camera, which is IN the head. So the property worth pinning
 * is not "nothing is near the head" — it is that a hood adds NOTHING to that
 * count, which is a statement about the hood and not about the view model.
 *
 * Visibility is resolved up the whole chain, because `_applyViewMode` hides
 * the neck's subtree by setting `visible` on each mesh and three's own
 * traversal does not inherit it.
 */
function nearHead(p, radius = 0.35) {
  p.rig.updateMatrices();
  const head = p.rig.get('head').obj;
  const c = new THREE.Vector3();
  head.getWorldPosition(c);
  const v = new THREE.Vector3();
  let n = 0, hooded = 0;
  p.rig.root.traverse((o) => {
    if (!o.isMesh) return;
    for (let a = o; a; a = a.parent) if (a.visible === false) return;
    const pos = o.geometry.attributes.position;
    let k = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.distanceTo(c) < radius) k++;
    }
    n += k;
    if (o.userData.hood) hooded += k;
  });
  return { n, hooded };
}

export async function run({ check, assert }) {
  /* The suite builds Players and Actors, both of which draw from the module
   * generators src/engine/MathUtil.js keeps at module scope. See _shared.mjs:
   * a suite that leaves those where it found them is one the next suite in the
   * run can trust. */
  check = await clocked(check);
  /* Rapier, for the two checks that destroy a body. Called here rather than
   * relied upon from an earlier suite for the reason creator.mjs states: a
   * check that passes or throws depending on what came before it in a
   * directory listing is not a check. */
  await initPhysics();

  /* ══════════════════════════════════════════════════════════════════ */
  /*  what a hood is, and where it hangs                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hoods: every kind builds, and hangs off the HEAD BONE', () => {
    assert(WORN.length >= 4,
      `only ${WORN.length} hood(s) that are cloth — the ask was "a few different kinds"`);
    const ids = new Set(HOOD_CUTS.map((h) => h.id));
    assert(ids.size === HOOD_CUTS.length, 'HOOD_CUTS has a duplicate id, which silently makes one card unpickable');
    assert(HOOD_CUTS.some((h) => h.none), 'there is no way to take a hood OFF');
    for (const h of HOOD_CUTS) {
      assert(h.name && h.blurb, `the ${h.id} row has no name or no blurb — the creator draws both`);
      assert(hoodCut(h.id) === h, `hoodCut('${h.id}') does not resolve to its own row`);
    }
    assert(hoodCut('no-such-hood') === null,
      'an unknown hood id resolves to a plausible default instead of a null — HANDOFF 2.3');

    const rows = [];
    for (const h of WORN) {
      const w = wearing(h.id);
      assert(w.hoods.length === 1,
        `${h.id} built ${w.hoods.length} meshes on the head; the budget is one`);
      assert(w.mesh.parent === w.head.obj,
        `${h.id} is parented to ${w.mesh.parent?.name || 'something that is not the head bone'} — `
        + 'Actor.goRagdoll re-homes bone children and orphans everything else');
      assert(w.mesh.userData.hood === h.id,
        `${h.id}'s mesh is not tagged with its own id, so the wardrobe seam cannot find it to take it off`);
      assert(w.mesh.userData.silhouette === true,
        `${h.id} is not tagged for the silhouette, so Enemy._applyLod culls the largest thing on the head at 30 m`);
      // and nothing anywhere else in the body carries the tag
      let stray = 0;
      w.rig.root.traverse((o) => { if (o.isMesh && o.userData.hood && o.parent !== w.head.obj) stray++; });
      assert(stray === 0, `${h.id} left ${stray} hood mesh(es) somewhere other than the head bone`);
      const g = w.mesh.geometry;
      rows.push(`${h.id} ${(g.index ? g.index.count : g.attributes.position.count) / 3}tri`);
    }
    // …and `none` really is nothing, not an empty mesh
    const bare = wearing('none');
    assert(bare.hoods.length === 0, '"No hood" still built something');
    return `${WORN.length} cuts, one mesh each on the head bone: ${rows.join(', ')}`;
  });

  check('hoods: a hood covers the head, measured against the skull under it', () => {
    /* THE CHECK THAT AN EXISTENCE ASSERTION CANNOT MAKE. Both cowls in this
     * game are sphere SEGMENTS whose opening has to be rotated onto the face —
     * three puts phi = 0 at -X — and a segment authored with the wrong start
     * angle covers the head perfectly with a hole over one ear. It builds, it
     * renders, it is one mesh on the right bone, and it is wrong. */
    const rows = [];
    for (const h of WORN) {
      const w = wearing(h.id);
      const c = coverage(w.head, w.mesh.geometry);
      assert(c.crownN > 50, `only ${c.crownN} skull vertices in the crown window — the window has drifted off the head`);
      assert(c.crown >= 0.78,
        `${h.id} leaves ${((1 - c.crown) * 100).toFixed(1)}% of the cranium bare — `
        + `a hood you can see the head through (${(c.crown * 100).toFixed(1)}% covered)`);
      rows.push(`${h.id} ${(c.crown * 100).toFixed(1)}%`);
    }
    // and the absence of a hood covers nothing, which is what makes the
    // numbers above a measurement of the cloth rather than of the ray test
    const none = wearing('none');
    const c0 = coverage(none.head, null);
    assert(c0.crown === 0, 'a bare head measured as covered — the ray test is answering yes to everything');
    return `crown and nape under cloth: ${rows.join(', ')} (bare head 0.0%)`;
  });

  check('hoods: and none of them covers the face you fight with', () => {
    /* The opposite failure and the more expensive one. Pulling a cut forward
     * until the coverage check above is happy is the obvious way to fix it and
     * it produces a bag over the head. Measured while tuning the desert wrap:
     * `theta: 0.44` put its front edge at y 0.087 and blocked 9.8% of this
     * band; 0.42 puts it at 0.097, on the brow ridge, and blocks none. */
    const rows = [];
    for (const h of WORN) {
      const w = wearing(h.id);
      const c = coverage(w.head, w.mesh.geometry);
      assert(c.eyeN > 20, `only ${c.eyeN} vertices in the eye band — the window has drifted off the face`);
      assert(c.eyes <= 0.02,
        `${h.id} covers ${(c.eyes * 100).toFixed(1)}% of the eyes, nose and mouth — that is a bag, not a hood`);
      rows.push(`${h.id} ${(c.eyes * 100).toFixed(1)}%`);
    }
    return `face left open: ${rows.join(', ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  four hoods and not one hood four times                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hoods: the kinds read apart at a glance, and apart from a bare head', () => {
    /* THE ROSTER'S OWN FAILURE, in a wardrobe row. Four Jedi ranks measured
     * 0.939 flank IoU against each other — "a Knight with three centimetres
     * more hilt" — and a list of garment cuts is more prone to it, because
     * every row after the first starts life as a copy of the one above it. So
     * the four are rasterised front and flank and read against each other, and
     * against the head with nothing on it: a cut that does not change the
     * OUTLINE is a texture swap. */
    const sil = {};
    for (const h of HOOD_CUTS) {
      const w = wearing(h.id);
      sil[h.id] = { front: outline(w.head, 'z'), flank: outline(w.head, 'x') };
    }
    let worst = 0, worstPair = '';
    for (let i = 0; i < WORN.length; i++) for (let j = i + 1; j < WORN.length; j++) {
      const a = WORN[i].id, b = WORN[j].id;
      const m = Math.max(iou(sil[a].front, sil[b].front), iou(sil[a].flank, sil[b].flank));
      if (m > worst) { worst = m; worstPair = `${a}/${b}`; }
    }
    assert(worst < 0.85,
      `${worstPair} share ${(worst * 100).toFixed(1)}% of one head outline — that is one hood twice`);

    let mildest = 0, mildestId = '';
    for (const h of WORN) {
      const m = Math.max(iou(sil.none.front, sil[h.id].front), iou(sil.none.flank, sil[h.id].flank));
      if (m > mildest) { mildest = m; mildestId = h.id; }
    }
    assert(mildest < 0.75,
      `${mildestId} leaves ${(mildest * 100).toFixed(1)}% of the bare head's outline intact — `
      + 'a hood that does not change the silhouette is a hat badge');
    return `worst pair ${worstPair} ${(worst * 100).toFixed(1)}%; `
      + `the least of them still redraws ${((1 - mildest) * 100).toFixed(0)}% of a bare head (${mildestId})`;
  });

  check('hoods: the inside of one is dark, which is most of why it reads as a hood', () => {
    /* Both hoods that existed were single-sided open shells, so the inside of
     * the cowl was not drawn at all and a face under one sat against whatever
     * happened to be behind the head. Every shell now carries a reversed copy
     * of itself at 92-95% of its size with its vertex colours knocked down —
     * the same channel `shadeAO` uses for every crease on the body, and no
     * material, no shader and no second draw call.
     *
     * Measured on the geometry rather than on the source: a lining that got
     * merged in without its colours, or with the winding not reversed, is the
     * exact failure this catches and it is invisible in a diff. */
    const rows = [];
    for (const h of WORN) {
      if (!h.shell || !h.shell.line) continue;
      const w = wearing(h.id);
      const col = w.mesh.geometry.attributes.color;
      assert(col, `${h.id} has no vertex colour channel at all — the lining was merged away`);
      let dark = 0, lit = 0, sum = 0;
      for (let i = 0; i < col.count; i++) {
        const v = col.getX(i);
        if (v < 0.999) { dark++; sum += v; } else lit++;
      }
      assert(dark > 100, `${h.id} has only ${dark} darkened vertices — there is no lining in it`);
      const mean = sum / dark;
      assert(mean <= 0.60,
        `${h.id}'s lining is ${mean.toFixed(3)} against an outer surface of 1.000 — not a recess, a highlight`);
      assert(lit > dark * 0.5, `${h.id} is ${lit} lit vertices against ${dark} dark — the whole hood went dark`);
      rows.push(`${h.id} ${mean.toFixed(2)}`);
    }
    assert(rows.length >= 4, `only ${rows.length} cut(s) carry a lining`);
    return `lining luminance against an outer surface of 1.000: ${rows.join(', ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the three ways a body stops being a body                          */
  /* ══════════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════ */
  /*  and the half of it that geometry cannot reach                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hoods: the fall off a hood is CLOTH, and it hangs where the hood ends', () => {
    /* "The hoods don't really look like hoods and ACT AS CLOTH."
     *
     * The shells above answer the first clause. This is the second: every cut
     * that declares a `drape` gets a simulated sheet pinned in an arc round the
     * back of the head bone — see `attachHoodDrape` in Cloth.js — and what is
     * measured here is that it settles where a hood's fall settles instead of
     * where a bug puts it. Two failures this catches and an eye does not:
     *
     *   IT IS CUT TO THE WRONG LENGTH BY THE FLARE. `Cloak`'s layout fans
     *   outward as it drops, so the rest length sampled between two rows is the
     *   DIAGONAL, not the vertical step. At the cape's flare of 0.85 a fall
     *   authored 0.085 m long came out 0.259 — three times its own stated
     *   length and reading as a second cape — and it is not stretch, so no
     *   stiffness setting touches it.
     *
     *   IT IS STRETCHED BY THE COLLIDERS. A hood's hem is at the neck, which is
     *   INSIDE the shoulders, so a cape's collider table swallows the pin ring
     *   whole; the row below the pins is shoved to the sphere's surface every
     *   frame while a 2 cm link says it cannot go there. Both come out as one
     *   number — the fall is longer than it was cut — so that is the number.
     */
    const rows = [];
    for (const h of WORN) {
      if (!h.drape) continue;
      const built = buildJedi({ scale: 1, hood: h.id, face: { hair: 'temple' } });
      built.rig.updateMatrices();
      const scene = new THREE.Scene();
      scene.add(built.rig.root);
      const d = attachHoodDrape(scene, built.rig, {
        scale: built.headScale ?? built.rig.scale ?? 1, drape: h.drape,
      });
      assert(d, `${h.id} declares a drape and attachHoodDrape built nothing from it`);
      const wind = new THREE.Vector3();
      for (let i = 0; i < 240; i++) { built.rig.updateMatrices(); d.update(1 / 60, d.refreshColliders(), wind); }

      // …it is not stretched. Every link against the length it was cut at.
      let worst = 0;
      for (const l of d.links) {
        const a = l.a * 3, b = l.b * 3;
        const len = Math.hypot(d.pos[a] - d.pos[b], d.pos[a + 1] - d.pos[b + 1], d.pos[a + 2] - d.pos[b + 2]);
        if (l.rest > 1e-6) worst = Math.max(worst, len / l.rest);
      }
      assert(worst < 1.35,
        `${h.id}'s fall has a link ${((worst - 1) * 100).toFixed(0)}% longer than it was cut — `
        + 'the colliders are pushing a row the pins are holding');

      // …and it hangs BELOW the hem it is pinned at and above the belt
      const head = built.rig.get('head'), hips = built.rig.get('hips');
      const hy = new THREE.Vector3(), by = new THREE.Vector3();
      head.obj.getWorldPosition(hy); hips.obj.getWorldPosition(by);
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < d.pos.length; i += 3) { if (d.pos[i] < lo) lo = d.pos[i]; if (d.pos[i] > hi) hi = d.pos[i]; }
      assert(hi < hy.y, `${h.id}'s fall reaches ${(hi - hy.y).toFixed(3)} m ABOVE the head bone — it is over the crown`);
      assert(lo > by.y + 0.08,
        `${h.id}'s fall reaches y ${lo.toFixed(3)} against a belt at ${by.y.toFixed(3)} — that is a cape, not a hood`);
      rows.push(`${h.id} ${(hi - lo).toFixed(2)}m, worst link ${worst.toFixed(2)}x`);
      scene.remove(built.rig.root);
    }
    assert(rows.length >= 3, `only ${rows.length} cut(s) have a fall on them`);
    return `hangs and stretch: ${rows.join(' · ')}`;
  });

  check('hoods: and the fall MOVES on the head that is wearing it', () => {
    /* THE WHOLE POINT, and the one thing a rigid hood cannot do however well it
     * is shaped: "more like putting on a solid capsule". A mesh welded to the
     * head bone travels 0.000 mm in that bone's own frame however hard the
     * figure turns — which is exactly the measurement Cloth.js makes against
     * the rigid skirt it replaced. So this is that measurement, on the hood:
     * turn the head through 0.9 rad and back, and ask how far the cloth has
     * moved RELATIVE TO THE HEAD. The rigid nape arc 3 cm above it is the
     * control and it is welded, so its answer is zero by construction.
     */
    const rows = [];
    for (const h of WORN) {
      if (!h.drape) continue;
      const built = buildJedi({ scale: 1, hood: h.id, face: { hair: 'temple' } });
      built.rig.updateMatrices();
      const scene = new THREE.Scene();
      scene.add(built.rig.root);
      const d = attachHoodDrape(scene, built.rig, {
        scale: built.headScale ?? built.rig.scale ?? 1, drape: h.drape,
      });
      const head = built.rig.get('head');
      const wind = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const turn = (yaw) => {
        head.obj.quaternion.copy(head.restQuat).multiply(q.setFromEuler(e.set(0, yaw, 0, 'YXZ')));
        built.rig.updateMatrices();
      };
      turn(0);
      for (let i = 0; i < 200; i++) d.update(1 / 60, d.refreshColliders(), wind);
      // where every particle sits in the HEAD's own frame, at rest
      const inv = new THREE.Matrix4().copy(head.obj.matrixWorld).invert();
      const v = new THREE.Vector3(), rest = [];
      for (let i = 0; i < d.pos.length; i += 3) {
        rest.push(v.set(d.pos[i], d.pos[i + 1], d.pos[i + 2]).applyMatrix4(inv).clone());
      }
      let worst = 0;
      for (let f = 0; f < 26; f++) {
        turn(Math.sin(f / 26 * Math.PI * 2) * 0.9);
        d.update(1 / 60, d.refreshColliders(), wind);
        inv.copy(head.obj.matrixWorld).invert();
        for (let i = 0, k = 0; i < d.pos.length; i += 3, k++) {
          const m = v.set(d.pos[i], d.pos[i + 1], d.pos[i + 2]).applyMatrix4(inv).distanceTo(rest[k]);
          if (m > worst) worst = m;
        }
      }
      assert(worst > 0.02,
        `${h.id}'s fall moved ${(worst * 1000).toFixed(1)} mm in the head's own frame through a `
        + '0.9 rad turn — it is welded to the skull, which is the complaint');
      rows.push(`${h.id} ${(worst * 1000).toFixed(0)} mm`);
      scene.remove(built.rig.root);
    }
    return `travel in the head's own frame over one turn: ${rows.join(', ')} (a rigid hood is 0)`;
  });

  check('hoods: first person leaves nothing of one in the frame', () => {
    /* `Player._applyViewMode` hides the head by traversing the NECK — "the head
     * bone carries fifteen meshes (jaw, ears, nose, eyes, brows, mouth, hair,
     * hood) and `parts` lists one" — so a hood on the head bone is hidden by
     * the shipped rule and a hood anywhere else is a cowl hanging in the middle
     * of the screen with the camera inside it.
     *
     * Driven through the real method on a real Player rather than restated
     * here, because a restated rule eventually disagrees with the one that
     * ships (HANDOFF 2.4) and this one is a consequence of a parent rather
     * than a line anybody would think to keep in step. */
    const bare = new Player(stubWorld('none'), { isLocal: true });
    bare.camera.firstPerson = true;
    bare.camera.firstPerson = true;
    bare._applyViewMode();
    const base = nearHead(bare).n;
    assert(base > 0,
      'a bare figure has NOTHING within 35 cm of its own head in first person — the view arms are gone, '
      + 'and this check would then pass for a hood that is also gone for the wrong reason');
    const rows = [];
    for (const h of WORN) {
      const world = stubWorld(h.id);
      const p = new Player(world, { isLocal: true });
      const head = p.rig.get('head');
      const hood = head.obj.children.filter((c) => c.isMesh && c.userData.hood);
      assert(hood.length === 1,
        `the wardrobe's ${h.id} did not reach the body Player built (${hood.length} hood meshes)`);
      p.camera.firstPerson = true;
      p._applyViewMode();
      const fp = nearHead(p);
      assert(hood.every((m) => !m.visible), `${h.id} is still visible in first person`);
      assert(fp.hooded === 0,
        `${h.id} leaves ${fp.hooded} vertices of cloth inside the first-person camera's own head`);
      assert(fp.n === base,
        `${h.id} changes what is in the first-person frame: ${fp.n} vertices near the head against ${base} bare`);
      // …and going back to third person has to bring it back, or the hood is
      // lost for the rest of the session the first time somebody presses V.
      p.camera.firstPerson = false;
      p._applyViewMode();
      assert(hood.every((m) => m.visible), `${h.id} did not come back when first person was left`);
      rows.push(h.id);
    }
    return `${rows.length} cuts hidden and restored; ${base} vertices near the head either way`;
  });

  check('hoods: a severed head takes its hood with it', () => {
    /* `Actor.cut` walks the subtree from the cut bone and hands every direct
     * child of each severed bone to the DetachedPiece; `Ragdoll.addBone` makes
     * each one visible again, because "a corpse is never headless". Both of
     * those act on DIRECT CHILDREN OF A BONE, which is the whole reason the
     * hood is one — a mesh a level down inside a positioning Group is hidden
     * by first person and missed by the re-home, which is the defect
     * creator.mjs records the human's braid having had.
     *
     * The body is put into first person before the cut for that reason: the
     * game really does cut heads off while every mesh under the neck has
     * `visible = false` on it. */
    const rows = [];
    for (const h of WORN) {
      const w = wearing(h.id);
      const hood = w.mesh;
      w.head.obj.traverse((o) => { if (o.isMesh) o.visible = false; });
      const actor = new Actor(new THREE.Scene(), new RapierWorld({ gravity: -22 }), w.rig, { scale: 1 });
      const ok = actor.cut('neck', 0.5, new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 1.5, 0));
      assert(ok, `${h.id}: the neck did not sever at all`);
      const piece = actor.pieces[0];
      assert(piece, `${h.id}: nothing came away`);
      let travelled = false, visible = false;
      for (const e of piece.entries) {
        e.holder.traverse((o) => { if (o === hood) { travelled = true; visible = o.visible; } });
      }
      assert(travelled,
        `${h.id}: the head came off and the hood stayed on the shoulders — it is not a child of the head bone`);
      assert(visible, `${h.id}: the severed head is wearing a hood that first person is still hiding`);
      let left = 0;
      w.rig.root.traverse((o) => { if (o === hood) left++; });
      assert(left === 0, `${h.id}: the hood is on the corpse AND on the head — it was copied, not re-homed`);
      rows.push(h.id);
    }
    return `${rows.length} cuts: hood travels with the head, comes back visible, nothing left on the body`;
  });

  check('hoods: a hood rides a ragdoll instead of standing in the air over it', () => {
    /* The failure this is for is the one Enemy.js names: "parented to
     * `rig.root`, where it would be orphaned the moment the body fell".
     * `goRagdoll` sets `rig.root.visible = false` and re-homes each bone's
     * direct children onto a holder driven by a physics body — so a hood on
     * the rig root does not fall, does not move, and is not even hidden with
     * the rest of the figure. Measured rather than asserted from the parent:
     * the hood has to end up UNDER the head's own holder and to have actually
     * travelled with it. */
    const rows = [];
    for (const h of WORN) {
      const w = wearing(h.id);
      const hood = w.mesh;
      const rest = new THREE.Vector3();
      hood.getWorldPosition(rest);
      const scene = new THREE.Scene();
      const phys = new RapierWorld({ gravity: -22 });
      const actor = new Actor(scene, phys, w.rig, { scale: 1 });
      actor.goRagdoll(new THREE.Vector3(0, 0, 2), null);
      for (let i = 0; i < 30; i++) { phys.step(1 / 60); actor.update(1 / 60); }
      const holder = actor.holders.get('head');
      assert(holder, `${h.id}: the ragdoll built no holder for the head`);
      let under = false;
      for (let a = hood; a; a = a.parent) if (a === holder) under = true;
      assert(under, `${h.id}: the hood is not under the head's ragdoll holder — it was orphaned by the fall`);
      let root = hood;
      while (root.parent) root = root.parent;
      assert(root === scene, `${h.id}: the hood is not in the scene the corpse was built in`);
      const now = new THREE.Vector3();
      hood.getWorldPosition(now);
      const moved = now.distanceTo(rest);
      assert(moved > 0.25,
        `${h.id}: the hood moved ${moved.toFixed(3)} m in half a second of falling — it is standing still `
        + 'where the living body was');
      rows.push(`${h.id} ${moved.toFixed(2)}m`);
    }
    return `all four fall with the head: ${rows.join(', ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the price, and the plumbing                                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hoods: a hood costs ONE draw call, and the Sentinel got one back', () => {
    /* THE BUDGET, STATED: one mesh per hood and not one per piece. A cut is a
     * shell, a lining, a rolled rim or a cord, a peak, three gathered folds
     * and a nape drape — seven pieces, and seven meshes if nobody counts, on a
     * head that `Enemy._applyLod` already keeps at every range because the
     * hood is tagged for the silhouette. Twenty hooded bodies would be 140
     * draw calls instead of 20, before the shadow pass doubles it.
     *
     * The Sentinel is the other half of the number. Its cowl was a sphere and
     * a torus as two separate meshes; it is one row of HOOD_CUTS now, through
     * the same Kit as everything else, so that rank went from 66 meshes to 65
     * — one draw call cheaper than before hoods existed at all. */
    const bare = meshCount(buildJedi({ scale: 1 }).rig.root);
    const rows = [];
    for (const h of WORN) {
      const n = meshCount(buildJedi({ scale: 1, hood: h.id }).rig.root);
      assert(n - bare === 1,
        `${h.id} costs ${n - bare} draw calls; the budget is 1`);
      rows.push(h.id);
    }
    assert(meshCount(buildJedi({ scale: 1, hood: 'none' }).rig.root) === bare,
      '"No hood" costs a draw call, which means it is drawing something');
    const sentinel = meshCount(buildJedi({ scale: 1, rank: 'sentinel' }).rig.root);
    assert(sentinel === bare + 1,
      `a Sentinel is ${sentinel} meshes against a bare Jedi's ${bare} — its cowl is not going through hoodOn`);
    return `${bare} meshes bare, ${bare + 1} in any of ${rows.length} hoods, ${sentinel} for a Sentinel`;
  });

  check('hoods: the Sentinel wears one of the wardrobe\'s cuts and not a private copy', () => {
    /* This is the §2.3 half of the feature: before it, "a hood" was written
     * out twice in one file and a third time on the acolyte, and the note over
     * JEDI_RANKS.sentinel says the two should be read "against each other by
     * colour and by what is under the hood, not by two different ideas of what
     * a hood is". A rank naming a row is only worth anything if the row is
     * what the rank actually gets, so that is measured on the built head
     * rather than read off the table. */
    assert(typeof JEDI_RANKS.sentinel.hood === 'string',
      'JEDI_RANKS.sentinel.hood is not a cut id — the rank is carrying its own idea of a hood again');
    const id = JEDI_RANKS.sentinel.hood;
    assert(hoodCut(id), `the Sentinel names a hood cut '${id}' that HOOD_CUTS does not have`);
    // `undefined` and not `'none'`: `buildJedi` reads `opts.hood ?? RANK.hood`,
    // so naming a cut here would answer the very question being asked.
    const rank = wearing(undefined, { rank: 'sentinel' });
    const worn = wearing(id);
    assert(rank.hoods.length === 1, 'a Sentinel built no hood at all');
    assert(rank.hoods[0].userData.hood === id, `a Sentinel is wearing '${rank.hoods[0].userData.hood}', not '${id}'`);
    // …and the two are the same shape, which a shared id alone does not prove
    const same = Math.min(iou(outline(rank.head, 'z'), outline(worn.head, 'z')),
      iou(outline(rank.head, 'x'), outline(worn.head, 'x')));
    assert(same > 0.995,
      `a Sentinel's head and a '${id}' head share only ${(same * 100).toFixed(1)}% of an outline`);
    return `the Sentinel's cowl IS HOOD_CUTS.${id} (${(same * 100).toFixed(1)}% identical outline)`;
  });

  check('hoods: the choice survives the trip from the creator to a live body', async () => {
    /* appearance.mjs's lesson, applied to the tenth wardrobe row: "that is the
     * third time in this project a shipped-looking feature turned out to be a
     * parameter nobody passed, which is why the checks here are about the
     * VALUE ARRIVING rather than about the control existing". So: the id
     * normalises, the creator has a row to pick it in, a Player built from the
     * settings is wearing it, and the seam swaps it on a body that is already
     * standing — which is the path a pick from the pause card takes. */
    assert(wardrobeOf({}).hood === 'none',
      'the wardrobe default puts a hood on every saved character who never asked for one');
    assert(DEFAULT_SETTINGS.wardrobe.hood === 'none', 'DEFAULT_SETTINGS carries no hood key');
    assert(wardrobeOf({ hood: 'cloak' }).hood === 'cloak', 'wardrobeOf drops a valid hood id');
    assert(wardrobeOf({ hood: 'not-a-hood' }).hood === 'none',
      'a blob off disk naming a hood that no longer exists is not normalised away');

    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    assert(/_wardrobeCards\('hood-list',[^)]*HOOD_CUTS\)/.test(menu),
      'the creator has no hood row, so the cuts exist and nobody can pick one');
    assert(html.includes('id="hood-list"'), 'index.html has no host element for the hood row');
    assert(/hood:\s*wardrobeOf\(this\.s\.wardrobe\)\.hood/.test(menu),
      'the creator preview ignores the hood, so the row is picked blind');

    // the body a deploy actually builds
    const world = stubWorld('sith');
    const p = new Player(world, { isLocal: true });
    world.players.push(p);
    const head = p.rig.get('head');
    const on = () => head.obj.children.filter((c) => c.isMesh && c.userData.hood).map((c) => c.userData.hood);
    assert(on().join() === 'sith', `a Player spawned in the Sith Cowl is wearing [${on()}]`);

    // …and the seam, which is how a pick lands without a redeploy
    world.settings.wardrobe = { ...WARDROBE, hood: 'wrap' };
    const dressed = applyWardrobe(world, world.settings);
    assert(dressed === 1, `applyWardrobe dressed ${dressed} bodies`);
    assert(on().join() === 'wrap', `after swapping to the Desert Wrap the head carries [${on()}]`);
    world.settings.wardrobe = { ...WARDROBE, hood: 'none' };
    applyWardrobe(world, world.settings);
    assert(on().length === 0, `taking the hood off left [${on()}] on the head`);

    // idempotent: the seam runs on every settings change, and a hood that
    // accumulated one merged shell per pick would be a leak nobody sees
    world.settings.wardrobe = { ...WARDROBE, hood: 'cowl' };
    for (let i = 0; i < 4; i++) applyWardrobe(world, world.settings);
    assert(on().length === 1, `four passes of the seam left ${on().length} hoods on one head`);
    return 'menu id -> wardrobeOf -> Player/buildJedi -> applyWardrobe, and back off again';
  });

  check('hoods: attachHood re-hoods a body that is already built, at the HEAD\'s scale', () => {
    /* The seam's entry point, and the one argument on it nobody would think to
     * check. `rig.scale` is the BODY's scale and everything on the head is
     * authored at the head's own — identical for every human-framed species
     * and 1.85x apart on the small-folk row, whose body is 0.40 of a human's
     * and whose head is 0.74. A hood built at the body's scale on that row is
     * 46% too small: a cowl that ends half way up the skull it is on.
     *
     * Measured as a RATIO of the hood's own size to the head's, so it holds
     * without a second table of expected millimetres per species. */
    const box = (o) => {
      const b = new THREE.Box3(), v = new THREE.Vector3();
      const p = o.geometry.attributes.position;
      o.updateMatrixWorld(true);
      for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      return b;
    };
    const rows = [];
    for (const sp of ['human', 'smallfolk']) {
      const built = buildJedi({ scale: 1, species: sp, face: { hair: 'temple' } });
      built.rig.updateMatrices();
      const head = built.rig.get('head');
      assert(!head.obj.children.some((c) => c.isMesh && c.userData.hood), `${sp} was built already hooded`);
      const m = attachHood(built, 'cowl');
      assert(m, `attachHood put nothing on a ${sp}`);
      assert(m.parent === head.obj, `attachHood parented a ${sp}'s hood off the head bone`);
      built.rig.updateMatrices();
      const skull = box(head.primary), hood = box(m);
      const rw = (hood.max.x - hood.min.x) / (skull.max.x - skull.min.x);
      assert(rw > 1.5 && rw < 2.6,
        `a ${sp}'s hood is ${rw.toFixed(2)}x the width of the skull it is on — `
        + 'it was built at the wrong scale (rig.scale is the BODY\'s, not the head\'s)');
      // and it is idempotent on a live body: a second call replaces, never adds
      attachHood(built, 'cloak');
      const now = head.obj.children.filter((c) => c.isMesh && c.userData.hood);
      assert(now.length === 1, `re-hooding a ${sp} left ${now.length} hoods on one head`);
      assert(now[0].userData.hood === 'cloak', `re-hooding a ${sp} kept the old cut`);
      assert(attachHood(built, 'none') === null && !head.obj.children.some((c) => c.isMesh && c.userData.hood),
        `'none' did not take the hood off a ${sp}`);
      rows.push(`${sp} ${rw.toFixed(2)}x`);
    }
    return `hood width against skull width: ${rows.join(', ')}`;
  });
}
