/**
 * A BODY, RENDERED, IN SECONDS AND WITHOUT A BROWSER.
 *
 *   node --import ./tools/register.mjs tools/_soft.mjs hawk
 *   node --import ./tools/register.mjs tools/_soft.mjs massiff 0.95
 *
 * Writes `.smoke/soft-<name>-{side,front,three,top}.png`.
 *
 * ── WHY THIS EXISTS BESIDE `portrait.mjs` AND `_beastshot.mjs` ────────────
 *
 * Both of those are right and neither can be used to ITERATE. They drive the
 * real engine through swiftshader, and HANDOFF §2.6 measures one frame there
 * at up to 4151 ms on an empty field; a screenshot forces a frame, and each
 * tool takes six or seven of them per body after a deploy that is itself
 * dozens of frames. Measured on this box while the four companion bodies were
 * being built: **four to six minutes per body**, and the run dies outright if
 * anything else is using the four cores. A body plan is thirty small decisions
 * and you cannot make thirty decisions at five minutes each.
 *
 * `tools/_silhouette.mjs` is the existing cheap answer and it is the right
 * shape for what it does — "enough to catch a wing inside a torso, a head at
 * the ankles, or an arm that never got built" — but a 42x34 ASCII grid cannot
 * answer the questions body work actually turns on: is that fur or is it
 * spines, is the bill pale against the head, does the wing read as a surface
 * or as a comb. Those are questions about MASS AND VALUE, not about extent.
 *
 * So this rasterises the built rig itself: orthographic, z-buffered, one flat
 * shade per triangle off a two-step ramp, the material's own colour (or its
 * emissive, for the lit parts), and a depth-discontinuity ink line so the
 * silhouette reads the way the shipped ink prepass makes it read. It is not
 * the game's shader and it is not trying to be — no shadows, no fog, no
 * texture, one light. It is a LOOK AT THE SHAPE, and it takes about a second.
 *
 * Everything downstream of `Bodies.js` is honest here — the meshes, the
 * transforms, the merge, the materials' colours — because it walks the same
 * `rig.root` the engine adds to the scene. What it cannot see is the ANIMATED
 * body: this is the build's own rest pose, so a gait defect still needs the
 * real thing.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { encodePng } from './_png.mjs';

const B = await import('../src/game/Bodies.js');
const OUT = join(resolve(new URL('..', import.meta.url).pathname), '.smoke');
mkdirSync(OUT, { recursive: true });

/** The bodies that are not a `CREATURE_PLANS` row, by their builder. */
const MAKERS = {
  astro: (o) => B.buildAstromech(o),
  medic: (o) => B.buildMedic(o),
  wook: (o) => B.buildWookiee(o),
  geonosian: (o) => B.buildGeonosian(o),
  trooper: (o) => B.buildTrooper(o),
  b1: (o) => B.buildB1(o),
  b2: (o) => B.buildB2(o),
  jedi: (o) => B.buildJedi(o),
  acolyte: (o) => B.buildAcolyte(o),
};

const which = process.argv[2] || 'hawk';
const scale = process.argv[3] ? Number(process.argv[3]) : undefined;
const built = MAKERS[which]
  ? MAKERS[which](scale ? { scale } : {})
  : B.buildQuadruped({ kind: which, scale: scale ?? 1 });
const root = built.rig ? built.rig.root : built.group;
root.updateMatrixWorld(true);

/* Every triangle, in world space, with the material it wears. Flattened once
 * so four views cost one traversal and not four. */
const tris = [];
{
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    /* THE EMISSIVE PARTS ARE DRAWN IN THEIR EMISSIVE COLOUR. `emissiveMat`
     * leaves `color` black and puts the value on `emissive`, so a lens read
     * off `color` comes back as a black disc — which is exactly what an
     * astromech's photoreceptor looked like here before this line. */
    const emis = !!(o.material?.emissive && o.material.emissiveIntensity > 1);
    /**
     * AND THE AUTHORED HEX, NOT `material.color`, WHICH IS NOT THE COLOUR THE
     * BODY WAS WRITTEN IN.
     *
     * `lit()` divides the requested colour by the bake's MEAN ALBEDO before it
     * hands it to the material, so that the shipped lighting multiplies it back
     * up. Reading `color` here therefore reads a pre-divided number and paints
     * it at full value: measured, a 0xa07146 muzzle came back as saturated
     * orange, and every judgement made about a body's VALUES off this tool was
     * a judgement about roughly 1/mean-albedo of them.
     *
     * Every material `lit` builds stamps `userData.authored` with the linear
     * [r, g, b] it was asked for. That is what a person looking at the picture is trying to
     * see, so that is what is drawn — and a material without one (a plain
     * MeshStandardMaterial somebody built by hand) falls through to `color`
     * exactly as before.
     */
    const authored = o.material?.userData?.authored;
    const col = emis ? o.material.emissive
      : (Array.isArray(authored) ? new THREE.Color().fromArray(authored)
        : (o.material?.color ? o.material.color : new THREE.Color(0x888888)));
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      tris.push([a.clone(), b.clone(), c.clone(), col, emis]);
    }
  });
}
const box = new THREE.Box3().setFromObject(root);
const centre = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const rad = Math.max(size.x, size.y, size.z) * 0.62;

const W = 520, H = 520;
const KEY = new THREE.Vector3(0.42, 0.78, 0.46).normalize();

/**
 * One view. `az`/`el` are where the CAMERA is, in radians, about the body's
 * own origin — the figure faces +Z, so az 0 is dead ahead of it and az π/2 is
 * its left flank.
 *
 * Framed on what THIS view projects rather than on the bounding box, because a
 * 2.6 m wingspan makes every other view of a hawk a postage stamp.
 */
function render(name, az, el) {
  const fwd = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 232; rgba[i * 4 + 1] = 236; rgba[i * 4 + 2] = 242; rgba[i * 4 + 3] = 255;
  }
  const zb = new Float32Array(W * H).fill(-1e9);
  let eu = 1e-6, ev = 1e-6;
  const dd = new THREE.Vector3();
  for (const [t0, t1, t2] of tris) for (const P of [t0, t1, t2]) {
    dd.subVectors(P, centre);
    eu = Math.max(eu, Math.abs(dd.dot(right))); ev = Math.max(ev, Math.abs(dd.dot(up)));
  }
  const s = Math.min(W / (eu * 2.15), H / (ev * 2.15));
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const [t0, t1, t2, col, emis] of tris) {
    e1.subVectors(t1, t0); e2.subVectors(t2, t0);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-16) continue;
    nrm.normalize();
    /* TWO STEPS AND A HARD EDGE — rule 1 of the art direction, and the reason
     * a smooth Lambert here would flatter shapes the shipped ramp will not.
     * `abs` because nothing here culls a back face. */
    const key = emis ? 1.25 : (Math.abs(nrm.dot(KEY)) > 0.42 ? 1.0 : 0.58);
    const r = Math.min(255, col.r * 255 * key), g = Math.min(255, col.g * 255 * key),
      bl = Math.min(255, col.b * 255 * key);
    const P = [t0, t1, t2];
    for (let i = 0; i < 3; i++) {
      const d = p[i].subVectors(P[i], centre);
      p[i].set(d.dot(right) * s + W / 2, H / 2 - d.dot(up) * s, d.dot(fwd));
    }
    const x0 = Math.max(0, Math.floor(Math.min(p[0].x, p[1].x, p[2].x)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(p[0].x, p[1].x, p[2].x)));
    const y0 = Math.max(0, Math.floor(Math.min(p[0].y, p[1].y, p[2].y)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(p[0].y, p[1].y, p[2].y)));
    const det = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p[1].x - px) * (p[2].y - py) - (p[2].x - px) * (p[1].y - py)) / det;
      const w1 = ((p[2].x - px) * (p[0].y - py) - (p[0].x - px) * (p[2].y - py)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * p[0].z + w1 * p[1].z + w2 * p[2].z;
      const i = y * W + x;
      if (z <= zb[i]) continue;
      zb[i] = z;
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = bl;
    }
  }
  /* THE INK, off the depth buffer: any pixel a long way in front of a
   * neighbour is an edge. It is the cheap half of what the shipped prepass
   * does and it is here for one reason — without a line the two-step ramp
   * merges every same-coloured shape into one mass, which is precisely the
   * defect a body pass is looking for. */
  const out = Uint8Array.from(rgba);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (zb[i] < -1e8) continue;
    const gap = Math.max(Math.abs(zb[i] - zb[i - 1]), Math.abs(zb[i] - zb[i + 1]),
      Math.abs(zb[i] - zb[i - W]), Math.abs(zb[i] - zb[i + W]));
    if (gap > rad * 0.035) { out[i * 4] = 24; out[i * 4 + 1] = 26; out[i * 4 + 2] = 30; }
  }
  const f = join(OUT, `soft-${which}-${name}.png`);
  writeFileSync(f, encodePng({ width: W, height: H, rgba: out }));
  console.log('wrote', f);
}

render('side', Math.PI / 2, 0.05);
render('front', 0, 0.05);
render('three', 0.9, 0.22);
render('top', 0.001, 1.35);
console.log(`${which}: ${tris.length} triangles, box `
  + `${box.min.toArray().map((n) => n.toFixed(2)).join(',')} → ${box.max.toArray().map((n) => n.toFixed(2)).join(',')}`);
