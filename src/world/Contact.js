/**
 * BATTLEFRONT BORZ — THE DARK UNDER A MAN'S FEET.
 *
 * Two findings from a blind playtest, and they are one defect:
 *
 *   "at 25 m an enemy is a 12 px blob at the same value as the terrain's ink
 *    strokes"
 *   "characters have no value separation from the ground and no contact shadow
 *    anchoring them"
 *
 * The cause is a gap between two systems that each stop for good reasons.
 * `Enemy` drops shadow casting past LOD 2 — about 62 m — because a cascade has
 * a reach and spending it on a man who is twelve pixels tall is spending it
 * badly. And the ink prepass fades its outline out between `INK.edgeFade`'s 55
 * and 130 m, because a line drawn on a twelve-pixel figure is a line thicker
 * than the figure.
 *
 * Both are right. Together they mean that from 55 m outward a body has no
 * outline, no shadow and no value separation, and the eye reads it as a smudge
 * of the same tone as the ground it is standing on. It does not read as far
 * away. It reads as not there.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────
 *
 * One instanced disc per living body, laid flat on the ground beneath it, dark
 * and hard-edged. Not a shadow — it does not follow the sun, it has no penumbra
 * and it is not occluded. It is the flat dark shape a cel-shaded figure is drawn
 * standing on, which is how the flat-band art this game is made of has always
 * anchored a figure: a hard shape under the feet, in the same visual language as
 * the ink.
 *
 * ── WHY IT IS NEARLY FREE ────────────────────────────────────────────────
 *
 * `src/world/Fallen.js` already proves the shape: hundreds of figures at two
 * draw calls, because they are one geometry with per-instance transforms. This
 * is the same trick with a simpler geometry — one disc, no skinning, no shadow
 * pass, written once a frame. At the populations `PLAN.md` is aiming at, a
 * per-body real shadow is unaffordable and this is what stands in for it.
 *
 * ── AND IT GROWS WITH DISTANCE, DELIBERATELY ─────────────────────────────
 *
 * A disc scaled to a man's feet is sub-pixel at 120 m, which would make it
 * useless exactly where it is needed most. `SPREAD` widens it with distance so
 * it holds a floor of `MIN_PX` screen pixels — the same reasoning the HUD uses
 * for a minimum tick size. Near, it is a shadow. Far, it is the mark that says
 * a body is standing there, and that is the job.
 */
import * as THREE from 'three';
import { noInk } from '../toon/Ink.js';

/** Radius under a man of ordinary size, in metres. */
export const BASE_R = 0.42;
/** The smallest the mark may be on screen, in pixels of a 1080-tall frame. */
export const MIN_PX = 5.0;
/** How dark, at the near end and the far end. Far is darker: it has less help. */
export const NEAR_A = 0.34;
export const FAR_A = 0.5;
/** Past this, a body is dressing rather than a contact — see `Cohorts.L3_AT`. */
export const REACH = 260;
/** How many marks one pool may draw. Past this the nearest win. */
export const CAP = 512;

export class ContactShadows {
  constructor(scene, opts = {}) {
    this.cap = opts.cap ?? CAP;
    const g = new THREE.CircleGeometry(1, 12);
    g.rotateX(-Math.PI / 2);
    /* Unlit and depth-written-off: this is a mark ON the ground, not an object
     * standing on it, and letting it fight the terrain for the depth buffer is
     * what produces the z-fighting shimmer a decal always produces. */
    const m = new THREE.MeshBasicMaterial({
      color: 0x0b0a08, transparent: true, opacity: 1,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(g, m, this.cap);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* NOT INKED. The outline pass draws every opaque object, and a hard black
     * line around a dark disc is a ring painted on the floor. `noInk` is the
     * door Ink.js publishes for exactly this. */
    noInk(m);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * One frame. `bodies` is anything with `position`, a `dead` flag and an
   * optional `bodyScale`; `terrain` supplies the floor.
   *
   * The whole pool is rewritten each frame rather than diffed, because a body
   * that walks is a body whose mark moves, so there is no static half to keep —
   * and a rewrite of five hundred matrices is cheaper than deciding which of
   * five hundred changed.
   */
  update(bodies, camera, terrain, viewH = 1080) {
    const mesh = this.mesh;
    if (!bodies || !camera) { mesh.count = 0; return 0; }
    const cam = camera.position;
    /* Screen-size floor: a disc of radius r at distance d covers about
     * `r / (d * tan(fov/2)) * viewH/2` pixels. Solved for r at MIN_PX. */
    const tan = Math.tan((camera.fov ?? 60) * Math.PI / 360);
    const pxToM = (d) => (MIN_PX * 2 * d * tan) / Math.max(1, viewH);

    let n = 0;
    for (const b of bodies) {
      if (n >= this.cap) break;
      if (!b || b.dead || b.alive === false || !b.position) continue;
      if (b.riding) continue;                       // his mark is the ship's business
      const dx = b.position.x - cam.x, dy = b.position.y - cam.y, dz = b.position.z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > REACH) continue;
      const r = Math.max(BASE_R * (b.bodyScale ?? 1), pxToM(d));
      const y = terrain ? terrain.height(b.position.x, b.position.z) : b.position.y;
      /* A HAND'S WIDTH OFF THE FLOOR, not on it. Coplanar with a heightfield is
       * z-fighting whatever the polygon offset says on a slope. */
      this._p.set(b.position.x, y + 0.035, b.position.z);
      this._s.set(r, 1, r * 0.82);                  // slightly oval, as a figure's is
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(n, this._m);
      /* Darker with distance: near, the real shadow and the ink are still doing
       * work and this only has to help; far, it is the only thing there. */
      const k = Math.min(1, d / 90);
      const a = NEAR_A + (FAR_A - NEAR_A) * k;
      this._c.setScalar(1 - a);                     // multiplied into the ground below
      mesh.setColorAt(n, this._c);
      n++;
    }
    mesh.count = n;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
