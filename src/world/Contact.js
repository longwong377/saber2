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
/** How dark, once it has faded in. See `NEAR_FREE`. */
export const NEAR_A = 0.34;
/**
 * CLOSER THAN THIS THE MARK IS NOT DRAWN AT ALL, and it is the correction to a
 * defect this file's own comments describe and did not implement.
 *
 * Every note here says the mark exists for the band past ~55 m where the ink
 * outline has faded and the shadow cascade has stopped, and that "near, the
 * real shadow and the ink are still doing work and this only has to help".
 * The arithmetic did not agree: `a = NEAR_A + (farA − NEAR_A)·min(1, d/90)` is
 * **0.34 at d = 0**, so a hard-edged 34%-dark oval was multiplied into the
 * ground directly under the player's own feet and under every enemy in melee
 * range, at the one distance where the renderer is already drawing a real
 * soft shadow for them.
 *
 * The player, twice: *"all enemies and also the player literally everyone has
 * a solid black circle underneath them, it's almost like a broken shadow
 * effect but it's really annoying"*. It is not a broken shadow. It is this,
 * doing exactly what it was told, at a distance nobody meant it to.
 *
 * So it fades in instead of starting on. Nothing about the far end moves —
 * `farAlphaFor`, `TARGET`, `MAX_A` and every number `cel.mjs` measures are
 * untouched, because the far end was never the problem.
 */
export const NEAR_FREE = 10;
/** …and by this distance it is fully faded in. Comfortably inside the ~55 m
 *  where the ink outline goes and the ~62 m where the cascade gives up, so the
 *  mark is at full strength before it is the only thing left. */
export const HELP_AT = 42;
/**
 * …AND HOW DARK AT THE FAR END, WHICH IS NOT A CONSTANT ANY MORE.
 *
 * `FAR_A = 0.5` was a fixed fraction of whatever it was drawn on, and a
 * fraction of a dark ground is nothing. Measured across the seven theatres, on
 * the ground value each one authors, the mark's own contrast against it:
 *
 *     alpine 1.69:1   colosseum 1.54:1   drifts 1.49:1   geonosis 1.39:1
 *     scoria 1.14:1   wood 1.14:1        mustafar 1.08:1
 *
 * — so on the three dark grounds the one thing carrying a body past 130 m,
 * where the outline has gone and the cascade stopped 70 m earlier, was
 * invisible. It is the second half of the finding this file opens with, and
 * the disc alone never discharged it.
 *
 * SO THE MARK AIMS AT A CONTRAST AND SOLVES FOR ITS OWN ALPHA. `TARGET` is
 * that contrast, in the WCAG sense — `(hi + 0.05) / (lo + 0.05)` on relative
 * luminance, which is the ratio that actually predicts whether two flat fields
 * can be told apart. `farAlphaFor` inverts it against the ground the level
 * authored, so a pale salt pan gets a much darker mark than a mid sand and a
 * lava field is not asked for one it cannot have.
 *
 * 2.0 rather than WCAG's 3.0 for large text: this is a hard-edged SHAPE with a
 * known silhouette under a figure the eye is already tracking, not a glyph to
 * be resolved cold, and 3.0 on the pale grounds asks for an alpha above 0.95 —
 * a black hole under every man on the field.
 *
 * AND WHERE IT CANNOT BE REACHED, IT IS NOT FAKED. On Mustafar the ground is
 * 0.009 and no disc, at any alpha, is 2:1 darker than that — the arithmetic
 * runs out at 1.18:1 with the mark at pure black. `MAX_A` is where it stops.
 * That is not a hole: on exactly those grounds the BODY carries itself, at
 * 3.18:1 to 6.92:1, because a pale figure on dark ground is the easiest thing
 * in this game to see. `cel.mjs` asserts the pair — every level, every army,
 * the best of the body's two bands and the mark clears 2:1 — which is the
 * honest statement of the design and would go red the day either half moved.
 */
export const TARGET = 2.0;
/**
 * The darkest the mark may be drawn.
 *
 * 0.96 and not a round 0.9, and the difference is one case: a Confederate droid
 * on Geonosis, which is the flagship mode's own army on the flagship mode's own
 * ground. Tan plastoid on red sand is the same value by design — it is what the
 * source material looks like — so the body cannot carry itself there and the
 * mark is the only road left. At 0.9 the mark reads 1.75:1 against that sand;
 * at 0.96 it reads 1.85:1, and the arithmetic ceiling with a PURE BLACK disc is
 * 1.92:1. So this is most of the way to what the ground can physically give,
 * chosen for that reason rather than for looking like a sensible number.
 *
 * It binds only on the dark grounds. `farAlphaFor` solves to 0.65–0.80 on the
 * four that can carry `TARGET`, so nothing pale ever gets a mark this heavy.
 */
export const MAX_A = 0.96;
/** Kept as the floor the solve starts from, and what a level with no authored
 *  ground value falls back to. It is the old constant and the old behaviour. */
export const FAR_A = 0.5;

/**
 * The far-end alpha that puts the mark `TARGET` away from this ground.
 *
 * @param groundLum  the ground's RELATIVE LUMINANCE where the mark is drawn —
 *                   the level's own authored base colour through the cel band,
 *                   which is what `World.loadLevel` hands over. Null or
 *                   nonsense falls back to `FAR_A`, which is what every level
 *                   had before this existed.
 *
 * A multiplied mark lands at `g·(1−a)`, so
 *
 *     (g + 0.05) / (g·(1−a) + 0.05) = TARGET
 *
 * solves to the line below. Clamped at both ends: never lighter than the old
 * constant, because that was already right on the mid grounds, and never
 * darker than `MAX_A`.
 */
export function farAlphaFor(groundLum) {
  const g = Number(groundLum);
  if (!(g > 1e-6)) return FAR_A;
  const want = ((g + 0.05) / TARGET - 0.05) / g;
  return Math.min(MAX_A, Math.max(FAR_A, 1 - want));
}
/** Past this, a body is dressing rather than a contact — see `Cohorts.L3_AT`. */
export const REACH = 260;
/** How many marks one pool may draw. Past this the nearest win. */
export const CAP = 512;

export class ContactShadows {
  constructor(scene, opts = {}) {
    this.cap = opts.cap ?? CAP;
    /** The far-end alpha, solved against this level's ground. See `setGround`. */
    this.farA = FAR_A;
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
       * work and this only has to help; far, it is the only thing there.
       * The gate is what makes that sentence true — see `NEAR_FREE`. */
      const k = Math.min(1, d / 90);
      const g = d <= NEAR_FREE ? 0
        : d >= HELP_AT ? 1
          : (d - NEAR_FREE) / (HELP_AT - NEAR_FREE);
      const a = (NEAR_A + (this.farA - NEAR_A) * k) * (g * g * (3 - 2 * g));
      if (a < 0.004) continue;                      // nothing to draw, and one fewer instance
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

  /**
   * Tell the pool what it is being drawn on.
   *
   * Called once per level load with the ground's relative luminance THROUGH
   * THE CEL BAND — the value on screen, not the authored albedo, because that
   * is the number the eye compares the mark against. `World.loadLevel` derives
   * it; nothing here reads a level table, so this file stays a leaf.
   */
  setGround(groundLum) {
    this.farA = farAlphaFor(groundLum);
    return this.farA;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
