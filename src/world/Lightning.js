/**
 * BATTLEFIELD BORZ — force lightning, as a thing in the air.
 *
 * ── THE COMPLAINT, WHICH HAS NOW BEEN MADE MANY TIMES ─────────────────────
 *
 * "I've told you this a hundred times by now but force lightning needs to be
 *  fucking LIGHTNING that comes out of your hands like I need to be able to
 *  fucking see the lightning come out and travel to where I'm aiming like this
 *  needs to sound and look cool as fuck but for the millionth time it's nothing
 *  in the air right now like there's no VFX or anything like why do you keep
 *  fucking this up"
 *
 * ── WHY IT KEPT LOOKING LIKE NOTHING, WHICH IS THREE SEPARATE REASONS ─────
 *
 * `Player._lightningArc` is not missing. It draws a seeded random walk with
 * forks, and the geometry of that walk is good. What it draws it WITH, and
 * WHEN it draws at all, are the problem, and every one of the three is fatal on
 * its own:
 *
 *   1. IT ONLY DREW BETWEEN THE HAND AND A BODY IT HIT. `forceLightning`
 *      collects the enemies inside a cone, and if that list is empty the whole
 *      method runs to completion having drawn NOTHING. Pressing it in the open
 *      — at a wall, at a distant line, at a body two metres outside the cone —
 *      produced no VFX whatsoever. That is literally "there's nothing in the
 *      air", and it is the single largest cause.
 *   2. IT WAS DRAWN OUT OF THE SPARK POOL. `P.sparks.spawn` is a shared ring of
 *      6 cm point sprites sized for blade hits and bolt impacts, and forty of
 *      them in a line is a dotted rule, not a discharge. It also competes for
 *      the same ring every cut in the fight is using — HANDOFF records a
 *      stratagem overflowing three shared rings, and this had the same shape.
 *   3. IT LASTED ONE FRAME. The whole power resolved in a single call: hit,
 *      damage, spawn, done. There was nothing to "travel", nothing to sweep,
 *      and at 60 Hz a 0.2 s particle life is a flicker.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────
 *
 * A dedicated pool of BOLTS, each a camera-facing ribbon of triangles, drawn
 * additively and lit. Not particles: a bolt is one continuous strip whose width
 * is in world units and whose brightness is its own, so it reads as a bright
 * line of plasma at any distance and any resolution rather than as a row of
 * dots that get further apart as you back away.
 *
 * THE RIBBON IS EXPANDED IN THE VERTEX SHADER, which is the one non-obvious
 * piece. `THREE.Line` has no usable thickness — `linewidth` is 1 px on every
 * WebGL implementation that matters — so each segment is two triangles whose
 * corners are pushed perpendicular to (segment direction × direction to the
 * camera). That is computed per vertex, per frame, on the GPU, so a bolt is
 * always face-on however the player turns and the CPU never rebuilds anything
 * but the spine.
 *
 * EVERY BOLT IS TWO. A wide, dim, saturated envelope and a narrow white-hot
 * core drawn on top of it. One ribbon at one colour reads as a neon tube; two
 * reads as electricity, and it is the same trick the engine nozzles use.
 *
 * ── COST ─────────────────────────────────────────────────────────────────
 *
 * One geometry, one draw call per layer, for every bolt on screen at once. The
 * pool is `MAX_BOLTS` spines of `MAX_POINTS`, allocated once at construction
 * and never resized; a bolt that expires is not freed, its vertices are
 * collapsed to a degenerate point. There is no allocation in `update` and none
 * in `strike`.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(0x11e7);

/** How many bolts can be alive at once. A chain of 4 off 3 roots is 12. */
export const MAX_BOLTS = 24;
/** Points per spine. The walk uses as many as the length asks for, up to this. */
export const MAX_POINTS = 40;
/** Samples per metre of bolt. A 2 m arc must not be as coarse as a 16 m one. */
export const STEPS_PER_M = 3.2;
/** How far the walk may stray, per step, before damping. 0.5 → 0.375: see the
 *  note on the layer widths in the constructor. */
export const WANDER = 0.375;
/** The chance a given interior sample throws a dead-end fork. */
export const FORK_CHANCE = 0.16;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * THE SHADER. Two attributes do the work: `aDir` is the segment's own direction
 * and `aSide` is which edge of the ribbon this vertex is. The expansion is
 * `normalize(cross(aDir, toCamera)) * halfWidth`, which is the standard
 * screen-facing ribbon and is exact for a strip that is thin relative to its
 * length — which a lightning bolt is by a factor of about two hundred.
 *
 * `aSeed` and `uTime` drive a per-vertex flicker so a bolt that is alive for a
 * quarter of a second is never the same shape twice — the crackle is in the
 * geometry rather than in the alpha, which is what stops a held channel reading
 * as a static tube.
 */
const VERT = /* glsl */`
attribute vec3 aDir;
attribute float aSide;
attribute float aWidth;
attribute float aSeed;
attribute float aFade;
varying float vFade;
varying float vEdge;
uniform float uTime;
void main() {
  vFade = aFade;
  vEdge = aSide;
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 side = cross(normalize(aDir), toCam);
  float l = length(side);
  side = l > 0.0001 ? side / l : vec3(1.0, 0.0, 0.0);
  /* The flicker: a fast, seeded wobble on the width, so the bolt breathes
     along its length instead of glowing evenly. */
  float f = 0.72 + 0.28 * sin(uTime * 47.0 + aSeed * 6.28318);
  wp.xyz += side * (aSide * aWidth * f);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/**
 * The fill. Hot in the middle of the ribbon and transparent at its edges, which
 * is what gives a flat strip a round cross-section — without it the bolt is a
 * hard-edged rectangle and reads as a ribbon rather than as a filament.
 */
const FRAG = /* glsl */`
precision mediump float;
varying float vFade;
varying float vEdge;
uniform vec3 uColor;
uniform float uGain;
void main() {
  float across = clamp(1.0 - abs(vEdge), 0.0, 1.0);
  /* ── CEL, NOT A GRADIENT ──────────────────────────────────────────────
     This was pow(across, 1.6) — a smooth falloff across the ribbon, which is
     a photographic filament and not this game's picture of one. Cel.js cannot
     reach here to fix it: it works by rewriting three's own ShaderChunks, and a
     hand-written ShaderMaterial like this one includes none of them, so every
     raw-shader effect in the tree has to carry the look itself.

     src/toon/REFERENCE.md's rule is flat fields with hard edges between them,
     so the cross-section is three steps rather than a ramp: a white-hot centre,
     one mid band, one outer band, and nothing in between. The fwidth guard is
     the one concession — a step edge with no antialiasing crawls badly on a
     ribbon this thin, and a half-pixel of blend at the boundary is what keeps
     the band HARD rather than making it soft. */
  float e = max(fwidth(across) * 0.5, 0.002);
  float b1 = smoothstep(0.30 - e, 0.30 + e, across);
  float b2 = smoothstep(0.68 - e, 0.68 + e, across);
  float band = 0.24 + b1 * 0.38 + b2 * 0.38;
  float a = band * vFade * uGain;
  if (a < 0.004) discard;
  /* The tint steps with the band instead of riding across continuously, or the
     colour would ramp smoothly across a shape whose alpha does not. */
  gl_FragColor = vec4(uColor * (0.62 + b1 * 0.34 + b2 * 0.52), a);
}`;

/** One drawable layer — an envelope or a core. Same spines, different width. */
class Layer {
  constructor(scene, { color, width, gain }) {
    const verts = MAX_BOLTS * MAX_POINTS * 2;
    const quads = MAX_BOLTS * (MAX_POINTS - 1) * 6;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(verts * 3);
    this.dir = new Float32Array(verts * 3);
    this.side = new Float32Array(verts);
    this.width = new Float32Array(verts);
    this.seed = new Float32Array(verts);
    this.fade = new Float32Array(verts);
    const idx = new Uint32Array(quads);
    for (let b = 0; b < MAX_BOLTS; b++) {
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const v = (b * MAX_POINTS + i) * 2;
        const o = (b * (MAX_POINTS - 1) + i) * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
      }
      for (let i = 0; i < MAX_POINTS; i++) {
        const v = (b * MAX_POINTS + i) * 2;
        this.side[v] = -1; this.side[v + 1] = 1;
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aDir', new THREE.BufferAttribute(this.dir, 3));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    this.geo.setAttribute('aWidth', new THREE.BufferAttribute(this.width, 1));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.geo.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, quads);
    this.baseWidth = width;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uGain: { value: gain }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class LightningVfx {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.color]  the bolt's own hue; the core is always hotter
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.color = opts.color ?? 0x9fd8ff;
    /* THE ENVELOPE IS SEVEN TIMES THE CORE, and dimmer by more than half. Any
     * narrower and the two read as one fat line with no glow around it; any
     * wider and the halo detaches from the filament inside it. The gain is what
     * keeps a dozen overlapping bolts from summing to white under additive
     * blending — which is what a channel is, twelve of them at once. */
    /* A QUARTER NARROWER THAN IT WAS — 0.15/0.020 became 0.1125/0.015 on the
     * player's note: "can you reduce the overall diameter of the lightning /
     * space it takes up by like 20-30%". The 7:1 ratio above is preserved
     * exactly, because that ratio is the thing the paragraph is about; both
     * numbers simply moved down together, so the halo still surrounds the
     * filament rather than detaching from it. `WANDER` came down by the same
     * quarter, since half of the "space it takes up" is how far the walk
     * strays rather than how fat the ribbon is. */
    this.envelope = new Layer(scene, { color: this.color, width: 0.1125, gain: 0.42 });
    this.core = new Layer(scene, { color: 0xffffff, width: 0.015, gain: 1.0 });
    /** Live bolts. Fixed length; `alive` is what makes one real. */
    this.bolts = [];
    for (let i = 0; i < MAX_BOLTS; i++) {
      this.bolts.push({
        alive: false, t: 0, life: 0.18, power: 1, n: 0,
        pts: Array.from({ length: MAX_POINTS }, () => new THREE.Vector3()),
        from: new THREE.Vector3(), to: new THREE.Vector3(),
      });
    }
    this._time = 0;
    this._next = 0;
    this._dirty = true;
  }

  setColor(hex) {
    this.color = hex;
    this.envelope.mat.uniforms.uColor.value.setHex(hex);
  }

  /**
   * FIRE ONE BOLT, from a point to a point.
   *
   * The spine is a random walk that HAS to arrive: the offset carries from one
   * step to the next so the path stays continuous, and it is multiplied by
   * `sin(pi t)` so it is pinned at both ends and free in the middle. That is
   * what makes it read as a discharge whipping between two fixed points rather
   * than as a wobbly line — and it is the one piece of `Player._lightningArc`
   * that was already right, kept.
   *
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {object} [o]
   * @param {number} [o.power] 0..1 — width and brightness
   * @param {number} [o.life]  seconds
   * @param {number} [o.chaos] how wide the walk strays
   */
  strike(from, to, o = {}) {
    const b = this.bolts[this._next];
    this._next = (this._next + 1) % MAX_BOLTS;
    const power = clamp(o.power ?? 1, 0.15, 2);
    b.from.copy(from); b.to.copy(to);
    _a.subVectors(to, from);
    const len = _a.length();
    if (len < 1e-3) return null;
    const n = clamp(Math.round(len * STEPS_PER_M) + 2, 4, MAX_POINTS);
    const chaos = (o.chaos ?? 1) * WANDER * clamp(len / 6, 0.35, 2.2);
    _b.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      _b.x = (_b.x + (rng() - 0.5) * chaos) * 0.72;
      _b.y = (_b.y + (rng() - 0.5) * chaos) * 0.72;
      _b.z = (_b.z + (rng() - 0.5) * chaos) * 0.72;
      const pin = Math.sin(Math.PI * t);
      b.pts[i].copy(from).addScaledVector(_a, t).addScaledVector(_b, pin);
    }
    b.n = n;
    b.alive = true;
    b.t = 0;
    b.life = o.life ?? 0.16;
    b.power = power;
    this._dirty = true;
    return b;
  }

  /**
   * A DEAD END — the short branch that goes nowhere.
   *
   * A real strike throws two or three of these for every one that arrives, and
   * they are most of what the eye reads as "lightning" rather than "a line".
   * They are ordinary bolts with a shorter life and a lower power, so they cost
   * nothing extra and expire first.
   */
  fork(at, along, len, o = {}) {
    _c.copy(along).normalize()
      .addScaledVector(_a.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), 1.2)
      .normalize().multiplyScalar(len);
    _c.add(at);
    return this.strike(at, _c, { power: (o.power ?? 1) * 0.5, life: (o.life ?? 0.16) * 0.7, chaos: 1.4 });
  }

  /** True while anything is on screen — the caller can skip the upload. */
  get busy() { return this.bolts.some((b) => b.alive); }

  update(dt) {
    this._time += dt;
    this.envelope.mat.uniforms.uTime.value = this._time;
    this.core.mat.uniforms.uTime.value = this._time;
    let any = false;
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.t += dt;
      if (b.t >= b.life) { b.alive = false; this._dirty = true; continue; }
      any = true;
    }
    if (!any && !this._dirty) {
      this.envelope.mesh.visible = false;
      this.core.mesh.visible = false;
      return;
    }
    this._write();
    this.envelope.mesh.visible = true;
    this.core.mesh.visible = true;
    this._dirty = any;
  }

  /**
   * The whole per-frame CPU cost, and it is deliberately one pass over the
   * live spines writing into buffers that were allocated once. A dead bolt's
   * vertices are collapsed onto its own first point rather than skipped,
   * because the index buffer is static: a degenerate triangle costs a vertex
   * shader invocation and rasterises nothing.
   */
  _write() {
    for (const layer of [this.envelope, this.core]) {
      const { pos, dir, width, seed, fade } = layer;
      for (let bi = 0; bi < MAX_BOLTS; bi++) {
        const b = this.bolts[bi];
        const base = bi * MAX_POINTS * 2;
        if (!b.alive) {
          for (let i = 0; i < MAX_POINTS; i++) {
            const v = base + i * 2;
            fade[v] = 0; fade[v + 1] = 0;
            width[v] = 0; width[v + 1] = 0;
          }
          continue;
        }
        /* THE FADE IS A SNAP AND A FALL. A bolt is at full brightness for the
         * first third of its life and then goes; a symmetric fade in and out
         * reads as a light being turned up, which lightning never does. */
        const age = b.t / b.life;
        const k = age < 0.3 ? 1 : 1 - (age - 0.3) / 0.7;
        for (let i = 0; i < MAX_POINTS; i++) {
          const v = base + i * 2;
          const p = b.pts[Math.min(i, b.n - 1)];
          const q = b.pts[Math.min(i + 1, b.n - 1)];
          const dead = i >= b.n;
          for (const off of [0, 1]) {
            const o3 = (v + off) * 3;
            pos[o3] = p.x; pos[o3 + 1] = p.y; pos[o3 + 2] = p.z;
            dir[o3] = q.x - p.x; dir[o3 + 1] = q.y - p.y; dir[o3 + 2] = q.z - p.z;
            if (i === b.n - 1 && b.n > 1) {
              const pp = b.pts[b.n - 2];
              dir[o3] = p.x - pp.x; dir[o3 + 1] = p.y - pp.y; dir[o3 + 2] = p.z - pp.z;
            }
            /* TAPERED AT BOTH ENDS, which is what makes it leave the hand and
             * land on the body rather than start and stop in mid-air. */
            const t = b.n > 1 ? i / (b.n - 1) : 0;
            const taper = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.45 + 0.55;
            width[v + off] = dead ? 0 : layer.baseWidth * b.power * taper;
            seed[v + off] = (bi * 7 + i) * 0.137;
            fade[v + off] = dead ? 0 : k;
          }
        }
      }
      layer.geo.attributes.position.needsUpdate = true;
      layer.geo.attributes.aDir.needsUpdate = true;
      layer.geo.attributes.aWidth.needsUpdate = true;
      layer.geo.attributes.aSeed.needsUpdate = true;
      layer.geo.attributes.aFade.needsUpdate = true;
    }
  }

  clear() {
    for (const b of this.bolts) b.alive = false;
    this._dirty = true;
    this.envelope.mesh.visible = false;
    this.core.mesh.visible = false;
  }

  dispose() {
    this.envelope.dispose();
    this.core.dispose();
    this.bolts.length = 0;
  }
}
