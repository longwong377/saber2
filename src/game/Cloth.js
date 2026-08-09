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

/**
 * The garment stream. Every cloak draws its own seed from here, so two Jedi in
 * the same shot do not wrinkle identically and one Jedi wrinkles the same way
 * every run. `seed` overrides it where a test needs a fixed cloak.
 *
 * This used to be seeded and then never called once — and a cloak with no
 * irregularity anywhere in it is the reason the sheet could not fold even once
 * the fabric was compressed: an evenly pinned cosine collar over an evenly
 * spaced grid is a perfectly symmetric buckling problem, and a symmetric
 * buckling problem has no preferred direction to buckle in. Folds nucleate at
 * irregularity. See `jitter`.
 */
const rng = makeRng(606011);

/** kinds, in the order the solver's stiffness table is indexed */
const STRUCT = 0, SHEAR = 1, BEND = 2;
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
    /**
     * Shear and bend are NOT the structural stiffness, and running them there
     * is why the cloth could not fold.
     *
     * 321 of the 496 links in a 9×11 sheet are shear or bend. Every one of them
     * crosses a would-be fold, and every one of them was solved bilaterally at
     * the structural 0.82 — so the moment a fold started to form, three hundred
     * constraints pushed it flat again. Bend in particular is the resistance of
     * fabric to CURVING, which for anything but leather is nearly nothing.
     *
     * `bendStretchOnly` is the other half: a bend link resists being pulled
     * straight and must not resist being folded. Solving it in compression is
     * an active anti-fold force with no physical counterpart.
     */
    this.shear = opts.shear ?? this.stiffness;
    this.bend = opts.bend ?? 0.10;
    /**
     * Bend, split by direction — `bend` runs ACROSS the cloth, `bendDown` runs
     * down it. Fabric really is anisotropic in bending, but the reason this
     * exists is arithmetic: a cape's folds are vertical, so it is the ACROSS
     * links that have to be soft, and the DOWN links are also the ones carrying
     * the garment's weight in a four-iteration verlet solve. Softening both to
     * 0.10 buys the folds and pays 71mm of sag on an 860mm cape; 0.55 down and
     * 0.10 across keeps 89% of the fold depth for 40mm, and leaves the hem 8%
     * narrower than it shipped instead of 17%.
     */
    this.bendDown = opts.bendDown ?? 0.55;
    this.bendStretchOnly = opts.bendStretchOnly !== false;
    /**
     * Surplus fabric, as a fraction of the laid-out span.
     *
     * reset() samples rest lengths off the taut layout, which makes a smooth
     * sheet the rest state — the solver was converging correctly on exactly the
     * thing that reads as stiff. A real garment has more cloth across it than
     * the shoulders it hangs from; that surplus is what a fold is made of. So
     * the ACROSS-cloth rest lengths are scaled below the span the pins hold the
     * collar at, which leaves the sheet in compression, and a compressed sheet
     * buckles. The diagonals keep their full length, which is what stops the
     * compression being taken up as a simple taper.
     */
    this.fullness = opts.fullness ?? 0.88;
    /** ±fraction of irregularity in the rest lengths — see the module rng. */
    this.jitter = opts.jitter ?? 0.06;
    /**
     * Aerodynamic coefficient, 1/s.
     *
     * Wind here was a uniform body force, which can translate a sheet and can
     * never deform one: every particle got the same push regardless of which
     * way it faced. The term that actually makes cloth flutter is the component
     * of relative air velocity along the surface NORMAL, k·(n·v_rel)·n, and it
     * was absent. It does work with no wind at all, because then v_rel is the
     * particle's own velocity and the term becomes normal drag — the reason
     * cloth planes through air instead of dropping like a plate.
     */
    this.lift = opts.lift ?? 1.0;
    /**
     * How much of the wind is still felt as a uniform body force.
     *
     * The aero term is not free force added on top: with lift 1.0 a face-on
     * particle catches roughly twice the push it used to, and left at 1 the
     * cape streamed backwards half its own length further at a walk. 0.7 keeps
     * the total force about where it was and moves the difference onto the
     * surface, which is the point — the same push, now direction-dependent.
     */
    this.drift = opts.drift ?? 0.7;
    /**
     * Per-frame velocity retention AT 60 fps.
     *
     * It used to be applied literally per frame, so the cloak was 0.972^60 =
     * 0.18 of its speed after a second at 60 fps and 0.972^144 = 0.017 at 144 —
     * an order of magnitude deader on a fast machine, which is a rendering
     * setting changing the physics. Raised to `dt·60` below, which is exactly
     * the old number at 60 fps and frame-rate independent everywhere else.
     */
    this.damping = opts.damping ?? 0.972;
    this.gravity = opts.gravity ?? -13;
    this.iterations = opts.iterations ?? 4;
    this.anchorFn = opts.anchorFn || null;
    this.flare = opts.flare ?? 0.85;   // how much wider the hem is than the collar
    this.colliders = [];               // {c: Vector3, r: number}, world space
    // one stream per cloak, drawn from the module's. reset() re-seeds from this
    // so a cloak that is laid out twice is the same cloak twice.
    this.seed = opts.seed ?? ((rng() * 1e9) | 0);

    const n = this.cols * this.rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.acc = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    for (let i = 0; i < this.cols; i++) this.pinned[i] = 1;

    // structural + shear + bend, built once. `across` marks the links that run
    // along a row: those are the ones `fullness` shortens.
    this.links = [];
    const idx = (c, r) => r * this.cols + c;
    const addLink = (a, b, kind, across) => {
      this.links.push({ a, b, rest: 0, kind, across, k: 0 });
    };
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (c + 1 < this.cols) addLink(idx(c, r), idx(c + 1, r), STRUCT, true);
        if (r + 1 < this.rows) addLink(idx(c, r), idx(c, r + 1), STRUCT, false);
        if (c + 1 < this.cols && r + 1 < this.rows) {
          addLink(idx(c, r), idx(c + 1, r + 1), SHEAR, false);
          addLink(idx(c + 1, r), idx(c, r + 1), SHEAR, false);
        }
        if (c + 2 < this.cols) addLink(idx(c, r), idx(c + 2, r), BEND, true);
        if (r + 2 < this.rows) addLink(idx(c, r), idx(c, r + 2), BEND, false);
      }
    }
    const K = [this.stiffness, this.shear, this.bend];
    for (const l of this.links) l.k = l.kind === BEND && !l.across ? this.bendDown : K[l.kind];

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
    this._dt = 1 / 60;                 // last frame length — see impulse()
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
        /*
         * Widen the LAYOUT by the same fraction the rest lengths below are
         * shortened by. Gathered fabric is narrower than flat fabric, so
         * `fullness` on its own takes the cape in — measured, a third off the
         * hem — and a costume with fullness in it is meant to be the same
         * finished width with MORE cloth, not a narrower cape. The compression
         * ratio the buckling lives off is unchanged, because both the layout
         * and the rest length move by the same factor. At fullness 1 this is
         * exactly 1 and the layout is the one that shipped.
         */
        const gather = 1 + (1 / this.fullness - 1) * t * t;
        const spread = (1 + this.flare * t * t) * gather;
        const i = (r * this.cols + c) * 3;
        this.pos[i] = this.prev[i] = centre.x + (_v1.x - centre.x) * spread;
        this.pos[i + 1] = this.prev[i + 1] = _v1.y - r * dropStep;
        this.pos[i + 2] = this.prev[i + 2] = centre.z + (_v1.z - centre.z) * spread + t * t * 0.06;
      }
    }
    /*
     * Rest lengths, and the one line that decides whether this thing can fold
     * at all.
     *
     * Sampling them straight off the layout — which is what this did — makes
     * the taut sheet the rest state: there is no surplus fabric anywhere in it,
     * so the solver has nothing to gather and converges, correctly, on a
     * smooth cylinder. `fullness` shortens the across-cloth rest lengths below
     * the span the collar is pinned at, which puts the sheet in compression;
     * `jitter` is what tells the compression where to buckle.
     */
    const noise = makeRng(this.seed);
    for (const l of this.links) {
      const a = l.a * 3, b = l.b * 3;
      const d = Math.hypot(this.pos[a] - this.pos[b], this.pos[a + 1] - this.pos[b + 1], this.pos[a + 2] - this.pos[b + 2]);
      // rest0 is the taut length, kept so a test can ask whether the cloth is
      // still the size it was cut — `rest` alone cannot answer that once
      // jitter has made the rest lengths deliberately inconsistent.
      l.rest0 = d;
      l.rest = d * (l.across ? this.fullness : 1) * (1 + (noise() * 2 - 1) * this.jitter);
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
    this._dt = dt;

    const n = this.cols * this.rows;
    const p = this.pos, q = this.prev;
    const g = this.gravity;
    const w = wind || this.wind;
    // A rate the frame counter cannot change. 0.972 per frame at 60 fps was
    // 0.972 per frame at 144 too, which is an order of magnitude more damping
    // on a faster machine; this is the same number at 60 and correct elsewhere.
    const damp = Math.pow(this.damping, dt * 60);

    this._aero(dt, w, g);

    // ── integrate
    const a = this.acc;
    for (let i = 0; i < n; i++) {
      if (this.pinned[i]) continue;
      const i3 = i * 3;
      for (let k = 0; k < 3; k++) {
        const cur = p[i3 + k];
        const vel = (cur - q[i3 + k]) * damp;
        q[i3 + k] = cur;
        p[i3 + k] = cur + vel + a[i3 + k] * dt * dt;
      }
    }

    // ── pin the top row to the wearer
    for (let c = 0; c < this.cols; c++) {
      this.anchorFn(c, this.cols, _v1);
      const i3 = c * 3;
      p[i3] = _v1.x; p[i3 + 1] = _v1.y; p[i3 + 2] = _v1.z;
    }

    // ── satisfy the links
    const stretchOnly = this.bendStretchOnly;
    for (let it = 0; it < this.iterations; it++) {
      for (let li = 0; li < this.links.length; li++) {
        const l = this.links[li];
        const a = l.a * 3, b = l.b * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        // a fold is a bend link in compression; pushing back on it is the one
        // thing this solver must not do
        if (stretchOnly && l.kind === BEND && d < l.rest) continue;
        const diff = (d - l.rest) / d * l.k;
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

  /**
   * Fill `acc` with gravity, the uniform wind, and the one term that can
   * actually deform a sheet.
   *
   * A uniform body force moves every particle the same way whichever way it
   * faces, so it can translate a cloak and it can never crease one — the cloak
   * had nothing else, which is a large part of why it read as a board. Air acts
   * on a surface through its NORMAL: the component of the relative air velocity
   * along n, pushed back along n. Edge-on the sheet slips through the air; face
   * on it is caught. That asymmetry is flutter, and with no wind at all it is
   * normal drag, which is what makes cloth settle instead of snapping.
   *
   * Normals come off the grid neighbours rather than from the mesh, because the
   * mesh's are one frame stale and only exist after _writeMesh.
   */
  _aero(dt, w, g) {
    const { cols, rows, pos: p, prev: q, acc: a, nrm: nv, lift } = this;
    const n = cols * rows;
    const inv = dt > 1e-9 ? 1 / dt : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, i3 = i * 3;
        const dr = this.drift;
        a[i3] = w.x * dr; a[i3 + 1] = g + w.y * dr; a[i3 + 2] = w.z * dr;
        if (lift === 0 || this.pinned[i]) continue;
        const l = (r * cols + Math.max(0, c - 1)) * 3, rr = (r * cols + Math.min(cols - 1, c + 1)) * 3;
        const u = (Math.max(0, r - 1) * cols + c) * 3, dn = (Math.min(rows - 1, r + 1) * cols + c) * 3;
        const ux = p[rr] - p[l], uy = p[rr + 1] - p[l + 1], uz = p[rr + 2] - p[l + 2];
        const vx = p[dn] - p[u], vy = p[dn + 1] - p[u + 1], vz = p[dn + 2] - p[u + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-9) { nv[i3] = nv[i3 + 1] = nv[i3 + 2] = 0; continue; }
        nx /= len; ny /= len; nz /= len;
        nv[i3] = nx; nv[i3 + 1] = ny; nv[i3 + 2] = nz;
        // relative air velocity: the wind the caller passes, less the particle's own
        const rx = w.x - (p[i3] - q[i3]) * inv;
        const ry = w.y - (p[i3 + 1] - q[i3 + 1]) * inv;
        const rz = w.z - (p[i3 + 2] - q[i3 + 2]) * inv;
        const dot = nx * rx + ny * ry + nz * rz;
        a[i3] += lift * dot * nx; a[i3 + 1] += lift * dot * ny; a[i3 + 2] += lift * dot * nz;
      }
    }
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

  /**
   * Kick the cloth — a Force push, a landing, a hard turn.
   *
   * In verlet the only way to set a velocity is to move `prev`, and a position
   * offset IS a velocity of offset/dt — so the fixed 0.02 here was 1.2 m/s at
   * 60 fps and 2.9 m/s at 144. Same bug as the damping, same fix: state the
   * kick in metres per second and let the frame length divide it. `speed` is
   * the old constant read back as what it always meant.
   *
   * The frame length comes off the last update rather than off an argument,
   * because every caller in the game already calls impulse() with two arguments
   * and a third one they do not pass is a fix that does not run.
   */
  impulse(dir, strength = 1, dt = this._dt) {
    const n = this.cols * this.rows;
    const speed = 1.2 * dt;
    for (let i = this.cols; i < n; i++) {
      const i3 = i * 3;
      const falloff = (Math.floor(i / this.cols) / this.rows) * strength;
      this.prev[i3] -= dir.x * falloff * speed;
      this.prev[i3 + 1] -= dir.y * falloff * speed;
      this.prev[i3 + 2] -= dir.z * falloff * speed;
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
    // ...and so were these two, so neither was reachable from any caller in
    // the game: every cloak ran the constructor defaults whatever it asked for.
    damping: opts.damping,
    iterations: opts.iterations,
    // the fabric parameters, so an author can put a heavy robe and a light
    // poncho on two different characters
    shear: opts.shear, bend: opts.bend, bendDown: opts.bendDown,
    bendStretchOnly: opts.bendStretchOnly, drift: opts.drift,
    fullness: opts.fullness, jitter: opts.jitter, lift: opts.lift, seed: opts.seed,
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
  /*
   * Re-sampled, because the first sampling took the robe's TUBE and the cape
   * hangs on its widest point. Measured off a standing Jedi as the largest
   * radius about the hips axis within 7cm of each sphere's own height:
   *
   *        dy      was     is     the robe's own surface
   *      -0.04    0.205  0.220
   *      -0.26    0.255  0.267
   *      -0.37    0.235  0.292    the over-skirt at its widest
   *      -0.48    0.205  0.286    still belling; the old table had it tapering
   *      -0.68    0.210  0.254    the under-robe hem
   *
   * The bottom half was 37-81mm inside the garment the player can see. A TAUT
   * cape never found that out, because it could not contract onto the body at
   * all — it stood off in a smooth cone and cleared everything. A cape with
   * fullness in it drapes, so it settles against whatever surface it is given,
   * and it went straight through the skirt. The error was always here; the
   * folds only made it visible.
   */
  const skirt = opts.skirt === false ? null : (opts.skirt ?? [
    [-0.04, 0.220], [-0.15, 0.235], [-0.26, 0.267], [-0.37, 0.292],
    [-0.48, 0.286], [-0.59, 0.242], [-0.68, 0.254],
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
