/**
 * SABER — cloth.
 *
 * A verlet cloak pinned to the shoulders. Robes are most of what makes a Jedi
 * read as a Jedi, and a robe that does not move reads as a painted cylinder —
 * so this one is simulated: gravity, wind, the wearer's own motion, and
 * collision against the body underneath so it never clips a leg mid-stride.
 *
 * Eighty particles and four constraint passes. Cheap enough that every duellist
 * on screen can have one.
 */

import * as THREE from 'three';
import { clamp, lerp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(606011);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Cloak {
  /**
   * @param anchorFn (i, n, out) → world position for pinned particle i
   * @param opts.cols/rows  resolution
   * @param opts.width      span across the shoulders
   * @param opts.length     how far it hangs
   */
  constructor(scene, opts = {}) {
    this.cols = opts.cols ?? 9;
    this.rows = opts.rows ?? 11;
    this.width = opts.width ?? 0.62;
    this.length = opts.length ?? 1.05;
    this.stiffness = opts.stiffness ?? 0.82;
    this.damping = opts.damping ?? 0.972;
    this.gravity = opts.gravity ?? -13;
    this.iterations = opts.iterations ?? 4;
    this.anchorFn = opts.anchorFn || null;
    this.flare = opts.flare ?? 0.85;   // how much wider the hem is than the collar
    this.colliders = [];               // {c: Vector3, r: number}, world space

    const n = this.cols * this.rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    for (let i = 0; i < this.cols; i++) this.pinned[i] = 1;

    // structural + shear + bend, built once
    this.links = [];
    const idx = (c, r) => r * this.cols + c;
    const addLink = (a, b) => {
      this.links.push({ a, b, rest: 0 });
    };
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (c + 1 < this.cols) addLink(idx(c, r), idx(c + 1, r));
        if (r + 1 < this.rows) addLink(idx(c, r), idx(c, r + 1));
        if (c + 1 < this.cols && r + 1 < this.rows) {
          addLink(idx(c, r), idx(c + 1, r + 1));
          addLink(idx(c + 1, r), idx(c, r + 1));
        }
        if (c + 2 < this.cols) addLink(idx(c, r), idx(c + 2, r));
        if (r + 2 < this.rows) addLink(idx(c, r), idx(c, r + 2));
      }
    }

    // ── mesh
    const geo = new THREE.PlaneGeometry(this.width, this.length, this.cols - 1, this.rows - 1);
    // PlaneGeometry's rows run bottom-to-top; ours run top-to-bottom
    this.geometry = geo;
    this.attrPos = geo.attributes.position;
    /*
     * A vertex-colour channel, for two reasons.
     *
     * The first is defensive: the wearer's own robe material is what gets
     * cloned onto this cloth, and Bodies.js now declares `vertexColors` on the
     * cloth family so it can carry baked creases. A material that declares
     * vertex colours over a geometry that has none renders BLACK — three
     * leaves the attribute unbound rather than falling back to white — so a
     * cloak with no channel would be a hole in the character.
     *
     * The second is that the channel is worth having anyway. A cloak is lit
     * from outside only; the inside of the collar and the folds behind the
     * shoulders never see the sky, and a flat gradient down the first fifth of
     * the cloth is what stops the whole thing reading as one bright sheet
     * pinned to a back. Values are linear, so 0.55 is 55% of the light.
     */
    const col = new Float32Array(this.cols * this.rows * 3);
    for (let r = 0; r < this.rows; r++) {
      const t = this.rows === 1 ? 1 : r / (this.rows - 1);
      // dark at the collar where the cloth is bunched under its own pins,
      // opening out to full light by a fifth of the way down
      const v = 0.55 + 0.45 * clamp(t / 0.20, 0, 1);
      for (let c = 0; c < this.cols; c++) {
        const i = (r * this.cols + c) * 3;
        col[i] = col[i + 1] = col[i + 2] = v;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = opts.material || new THREE.MeshStandardMaterial({
      color: opts.color ?? 0x5a4530, roughness: 0.94, metalness: 0,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.scene = scene;

    this.initialised = false;
    this.wind = new THREE.Vector3();
    this.enabled = true;
  }

  /** Lay the cloth out flat under its anchors — call once it has a wearer. */
  reset() {
    if (!this.anchorFn) return;
    const dropStep = this.length / (this.rows - 1);
    // the rest shape is a flared cone, so the links remember a cloak
    this.anchorFn((this.cols - 1) / 2, this.cols, _v4);
    const centre = _v4.clone();
    for (let c = 0; c < this.cols; c++) {
      this.anchorFn(c, this.cols, _v1);
      for (let r = 0; r < this.rows; r++) {
        const t = this.rows === 1 ? 0 : r / (this.rows - 1);
        const spread = 1 + this.flare * t * t;
        const i = (r * this.cols + c) * 3;
        this.pos[i] = this.prev[i] = centre.x + (_v1.x - centre.x) * spread;
        this.pos[i + 1] = this.prev[i + 1] = _v1.y - r * dropStep;
        this.pos[i + 2] = this.prev[i + 2] = centre.z + (_v1.z - centre.z) * spread + t * t * 0.06;
      }
    }
    // rest lengths come from the laid-out shape, so the cloth starts relaxed
    for (const l of this.links) {
      const a = l.a * 3, b = l.b * 3;
      l.rest = Math.hypot(this.pos[a] - this.pos[b], this.pos[a + 1] - this.pos[b + 1], this.pos[a + 2] - this.pos[b + 2]);
    }
    this.initialised = true;
    this._writeMesh();
  }

  /** @param colliders array of world-space {c, r} spheres for the body beneath */
  update(dt, colliders, wind) {
    if (!this.enabled || !this.anchorFn) return;
    if (!this.initialised) { this.reset(); return; }
    // a long frame would explode a verlet solve; take the hit as slow motion
    dt = Math.min(dt, 1 / 45);

    const n = this.cols * this.rows;
    const p = this.pos, q = this.prev;
    const g = this.gravity * dt * dt;
    const w = wind || this.wind;
    const wx = w.x * dt * dt, wy = w.y * dt * dt, wz = w.z * dt * dt;
    const damp = this.damping;

    // ── integrate
    for (let i = 0; i < n; i++) {
      if (this.pinned[i]) continue;
      const i3 = i * 3;
      for (let k = 0; k < 3; k++) {
        const cur = p[i3 + k];
        const vel = (cur - q[i3 + k]) * damp;
        q[i3 + k] = cur;
        p[i3 + k] = cur + vel + (k === 0 ? wx : k === 1 ? g + wy : wz);
      }
    }

    // ── pin the top row to the wearer
    for (let c = 0; c < this.cols; c++) {
      this.anchorFn(c, this.cols, _v1);
      const i3 = c * 3;
      p[i3] = _v1.x; p[i3 + 1] = _v1.y; p[i3 + 2] = _v1.z;
    }

    // ── satisfy the links
    for (let it = 0; it < this.iterations; it++) {
      for (let li = 0; li < this.links.length; li++) {
        const l = this.links[li];
        const a = l.a * 3, b = l.b * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        const diff = (d - l.rest) / d * this.stiffness;
        const pa = this.pinned[l.a], pb = this.pinned[l.b];
        if (pa && pb) continue;
        const wa = pa ? 0 : (pb ? 1 : 0.5), wb = pb ? 0 : (pa ? 1 : 0.5);
        p[a] += dx * diff * wa; p[a + 1] += dy * diff * wa; p[a + 2] += dz * diff * wa;
        p[b] -= dx * diff * wb; p[b + 1] -= dy * diff * wb; p[b + 2] -= dz * diff * wb;
      }

      // ── push out of the body
      const cols = colliders || this.colliders;
      for (let ci = 0; ci < cols.length; ci++) {
        const s = cols[ci];
        const cx = s.c.x, cy = s.c.y, cz = s.c.z, r = s.r;
        for (let i = this.cols; i < n; i++) {     // skip the pinned row
          const i3 = i * 3;
          const dx = p[i3] - cx, dy = p[i3 + 1] - cy, dz = p[i3 + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), k = (r - d) / d;
          p[i3] += dx * k; p[i3 + 1] += dy * k; p[i3 + 2] += dz * k;
        }
      }
    }

    this._writeMesh();
  }

  _writeMesh() {
    const arr = this.attrPos.array;
    const p = this.pos;
    // PlaneGeometry vertex r=0 is the TOP row, which matches our layout
    for (let i = 0; i < this.cols * this.rows; i++) {
      arr[i * 3] = p[i * 3];
      arr[i * 3 + 1] = p[i * 3 + 1];
      arr[i * 3 + 2] = p[i * 3 + 2];
    }
    this.attrPos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /** Kick the cloth — a Force push, a landing, a hard turn. */
  impulse(dir, strength = 1) {
    const n = this.cols * this.rows;
    for (let i = this.cols; i < n; i++) {
      const i3 = i * 3;
      const falloff = (Math.floor(i / this.cols) / this.rows) * strength;
      this.prev[i3] -= dir.x * falloff * 0.02;
      this.prev[i3 + 1] -= dir.y * falloff * 0.02;
      this.prev[i3 + 2] -= dir.z * falloff * 0.02;
    }
  }

  setVisible(v) { this.mesh.visible = v; }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    if (!this._sharedMat) this.mat.dispose();
  }
}

/**
 * Build a cloak that hangs from a rig's chest bone, with colliders tracking
 * the torso and legs so it drapes instead of clipping.
 */
export function attachCloak(scene, rig, opts = {}) {
  const S = opts.scale ?? 1;
  const chest = rig.get('chest');
  if (!chest) return null;

  // NB: (opts.width ?? 0.6) * S — the * S used to bind to the default only, so
  // any scaled character got a collar half as wide as its own cloth.
  const halfSpan = ((opts.width ?? 0.6) * S) * 0.5;
  const cloak = new Cloak(scene, {
    cols: opts.cols ?? 9,
    rows: opts.rows ?? 11,
    width: (opts.width ?? 0.6) * S,
    length: (opts.length ?? 1.0) * S,
    color: opts.color ?? 0x4c3a26,
    material: opts.material,
    flare: opts.flare,                 // was silently dropped on the floor
    stiffness: opts.stiffness,
    gravity: opts.gravity ?? -13,
    anchorFn: (c, n, out) => {
      // spread the pins across the shoulders, slightly behind the back
      const t = n === 1 ? 0.5 : c / (n - 1);
      _m.copy(chest.obj.matrixWorld);
      out.set(lerp(-halfSpan, halfSpan, t), chest.length * 0.92, -0.10 * S);
      // bow the collar so it sits on the shoulders rather than in a straight line
      out.z -= Math.cos((t - 0.5) * Math.PI) * 0.055 * S;
      out.applyMatrix4(_m);
    },
  });
  cloak._sharedMat = !!opts.material;

  const bones = ['chest', 'spine', 'hips', 'thighL', 'thighR', 'shinL', 'shinR'];
  const radii = [0.20, 0.19, 0.20, 0.13, 0.13, 0.10, 0.10];

  /**
   * THE SKIRT the cape actually hangs over.
   *
   * The list above models a body with BARE LEGS: a 13cm thigh and a 10cm shin.
   * Everyone who gets a cloak in this game is wearing a robe, and that robe is
   * a 19-26cm tube round the same legs — so the cloth was settling against a
   * surface 6-9cm inside the one the player can see. Measured on a standing
   * Jedi: cloak particles up to 47mm inside the robe's own surface, on 164 of
   * 180 frames. A cape passing through a skirt.
   *
   * Sampled off the built robe rather than typed: local y is measured DOWN
   * from the hips bone, and the radii are the over-skirt (belling from the belt
   * to a hem just above the knee) and the under-robe below it. Spaced 11cm
   * apart with radii twice that, so consecutive spheres overlap heavily and
   * the cloth cannot dip between them. `skirt: false` turns it off for anything
   * that really is wearing trousers.
   */
  const skirt = opts.skirt === false ? null : (opts.skirt ?? [
    [-0.04, 0.205], [-0.15, 0.225], [-0.26, 0.255], [-0.37, 0.235],
    [-0.48, 0.205], [-0.59, 0.205], [-0.68, 0.210],
  ]);
  const hipsB = rig.get('hips');

  cloak.refreshColliders = () => {
    const out = cloak.colliders;
    out.length = 0;
    for (let i = 0; i < bones.length; i++) {
      const b = rig.get(bones[i]);
      if (!b || b.severed) continue;
      b.obj.updateMatrixWorld(false);
      // two spheres per bone so a thigh is a limb, not a marble
      for (const t of [0.25, 0.8]) {
        _v3.set(0, b.length * t, 0).applyMatrix4(b.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: radii[i] * S });
      }
    }
    if (skirt && hipsB && !hipsB.severed) {
      hipsB.obj.updateMatrixWorld(false);
      for (let i = 0; i < skirt.length; i++) {
        _v3.set(0, skirt[i][0] * S, 0).applyMatrix4(hipsB.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: skirt[i][1] * S });
      }
    }
    return out;
  };
  return cloak;
}
