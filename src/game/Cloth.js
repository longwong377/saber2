/**
 * BATTLEFRONT BORZ — cloth.
 *
 * A verlet SHEET pinned to the shoulders and a verlet TUBE pinned to the hips.
 * Robes are most of what makes a Jedi read as a Jedi, and a robe that does not
 * move reads as a painted cylinder — so both are simulated: gravity, wind, the
 * wearer's own motion, and collision against the body underneath so neither
 * clips a leg mid-stride.
 *
 * THE SHEET was here first and was the whole of it, which is exactly what a
 * playtest caught: "the cape looks good with the physics but when it's in
 * motion you see that underneath the model's clothes is just a hard cylinder".
 * Nothing was wrong with the cape. The robe beside it was five lathes parented
 * to the `hips` bone with the folds baked into the mesh section and into the
 * vertex-colour occlusion, and a hem vertex of it travels EXACTLY 0.000 mm in
 * the pelvis frame over seven seconds of walking while the cape's hem travels
 * 217 mm. One garment moving next to one that cannot is worse than neither
 * moving, because the eye only needs one of them to tell it which is cloth.
 *
 * A tube is not a sheet with its ends touching, and four things in here assumed
 * otherwise — see `closed`, the mesh in the constructor, `pinRows`, and the
 * note on `fullness` in reset(), which is the one that mattered.
 *
 * A hundred particles each and four constraint passes. Cheap enough that every
 * duellist on screen can have both, and both are switched off past lod > 1.
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
    /**
     * A SHEET or a TUBE.
     *
     * A cape is a sheet with two free vertical edges. A skirt is not: it is a
     * closed loop of cloth, and every part of this class quietly assumed it was
     * not. Links were built with `if (c + 1 < this.cols)`, so column 0 and
     * column cols-1 were never joined — laid out as a ring that leaves a gap at
     * the back which nothing holds shut, and two free edges that flap
     * independently of each other. The mesh was a PlaneGeometry with a 1:1
     * vertex↔particle map, which cannot close either.
     *
     * `closed` wraps the across-cloth links (structural, shear and bend) modulo
     * cols and swaps the mesh for a cylindrical index buffer with a duplicated
     * seam column mapped back onto particle 0.
     *
     * It does NOT make `fullness` work on a skirt, which was the first guess
     * and is measurably wrong — a ring with a short rest circumference simply
     * adopts the matching radius, and the tube fell in on itself. See `pleat`
     * and the note in reset().
     */
    this.closed = !!opts.closed;
    /**
     * How many rows the anchor holds.
     *
     * The pinned set was hard-coded as row 0 in three places — the constructor,
     * the collision loop (`for (let i = this.cols; i < n; i++)`) and impulse().
     * That is right for a collar and right for a waistband, but it was an
     * assumption rather than a parameter, and every one of those loops is now
     * driven by `pinned[]` itself so any pin set works. anchorFn is handed the
     * row index as its fourth argument.
     */
    this.pinRows = Math.max(1, Math.min(opts.pinRows ?? 1, this.rows));
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
     * A cut fold, as ±fraction of the across rest length. See reset().
     * `pleatHarm` is how many of them go round; the cosine sums to zero over a
     * whole ring, so a pleat adds no cloth, only shape.
     */
    this.pleat = opts.pleat ?? 0;
    this.pleatHarm = opts.pleatHarm ?? 5;
    this.pleatPhase = opts.pleatPhase ?? 0.4;
    /**
     * AN ASYMMETRIC HEM, as ±fraction of the drop.
     *
     * Every other parameter in here is a property of the whole ring, so every
     * garment they can describe is a solid of revolution with a wrinkle on it.
     * A real robe is not: it wraps, and one side of the hem finishes lower than
     * the other. `hemBias` scales the per-column drop by 1 + hemBias·cos(θ +
     * hemPhase), which cuts the panel long on one side and short on the other —
     * and because reset() samples the rest lengths off the layout, the vertical
     * links on the long side really are longer. The garment is CUT that way; it
     * is not a symmetric garment displaced, and it does not settle back.
     *
     * The profile is read at the biased t as well, so the long side keeps
     * hugging the body's own silhouette at the height it actually reaches
     * instead of holding the radius its row index would have had.
     */
    this.hemBias = opts.hemBias ?? 0;
    this.hemPhase = opts.hemPhase ?? 0;
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
    /**
     * The power the flare is raised to down the cloth.
     *
     * A cape's flare is t², which is nothing at the collar and everything at
     * the hem — right for a mantle hanging off two shoulders. A skirt belled
     * off a belt is fuller much sooner: the rigid over-skirt this replaces
     * carries a +26% swell at 22% of its length. Left at 2 the cloth laid out
     * 60mm inside the garment it stands in for through the whole middle of the
     * skirt, and had to be pushed back out by the colliders every frame.
     */
    this.flarePow = opts.flarePow ?? 2;
    /**
     * The rest silhouette, as a radial multiplier on the anchor ring — t=0 at
     * the anchor, t=1 at the hem. Overrides `flare` when given.
     *
     * A cape's rest shape is a power law because a cape is a flat panel that
     * falls open. A skirt's is not: the garment this replaces bells 51% in its
     * first sixth, flattens through the middle and climbs again to the hem,
     * which is the swell the lathe carries and no exponent reproduces. More to
     * the point, see `fullness` below — on a closed cloth the layout profile IS
     * the surface the folds are gathered against, so it has to be the real one.
     */
    this.profile = opts.profile || null;
    /**
     * Backward lean of the hem, metres, at full drop.
     *
     * A cape hangs off the back of a pair of shoulders and wants to trail; a
     * TUBE that leans is a tube translated backwards, which is not a lean at
     * all. Kept at the shipped 0.06 for a sheet and defaulted to 0 for a
     * closed one.
     */
    this.lean = opts.lean ?? (this.closed ? 0 : 0.06);
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
    for (let i = 0; i < this.cols * this.pinRows; i++) this.pinned[i] = 1;

    // structural + shear + bend, built once. `across` marks the links that run
    // along a row: those are the ones `fullness` shortens.
    //
    // THE SEAM. On a closed cloth the across index wraps, so column cols-1 is
    // joined to column 0 by a structural link, by both diagonals and by the
    // bend link that reaches two columns on — the same three families the
    // interior gets, which is the point: a seam that is only structural is a
    // hinge, and cloth hinged at one column folds there every time.
    this.links = [];
    const wrap = this.closed;
    const nextC = (c, d) => (wrap ? (c + d) % this.cols : c + d);
    const hasC = (c, d) => (wrap ? this.cols > 2 * d : c + d < this.cols);
    const idx = (c, r) => r * this.cols + c;
    const addLink = (a, b, kind, across) => {
      this.links.push({ a, b, rest: 0, kind, across, k: 0 });
    };
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (hasC(c, 1)) addLink(idx(c, r), idx(nextC(c, 1), r), STRUCT, true);
        if (r + 1 < this.rows) addLink(idx(c, r), idx(c, r + 1), STRUCT, false);
        if (hasC(c, 1) && r + 1 < this.rows) {
          addLink(idx(c, r), idx(nextC(c, 1), r + 1), SHEAR, false);
          addLink(idx(nextC(c, 1), r), idx(c, r + 1), SHEAR, false);
        }
        if (hasC(c, 2)) addLink(idx(c, r), idx(nextC(c, 2), r), BEND, true);
        if (r + 2 < this.rows) addLink(idx(c, r), idx(c, r + 2), BEND, false);
      }
    }
    const K = [this.stiffness, this.shear, this.bend];
    for (const l of this.links) l.k = l.kind === BEND && !l.across ? this.bendDown : K[l.kind];

    // ── mesh
    /*
     * A sheet gets a PlaneGeometry with a 1:1 vertex↔particle map. A TUBE
     * cannot: the last column has to meet the first, and a grid with cols
     * vertex columns has no edge to close on. So the closed mesh carries
     * cols+1 vertex columns and `_vmap` sends the extra one back to particle 0
     * — a duplicated seam vertex, which is also what lets the UV run 0→1 round
     * the garment without the last quad's u snapping back to zero.
     *
     * The duplicate costs a lighting seam if nothing is done about it, because
     * computeVertexNormals gives each copy only the faces on its own side.
     * _writeMesh averages the pair afterwards — `rows` vertices of work.
     */
    let geo;
    if (this.closed) {
      const vc = this.cols + 1, vr = this.rows;
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vc * vr * 3), 3));
      const uv = new Float32Array(vc * vr * 2);
      this._vmap = new Uint16Array(vc * vr);
      for (let r = 0; r < vr; r++) {
        for (let c = 0; c < vc; c++) {
          const v = r * vc + c;
          this._vmap[v] = r * this.cols + (c % this.cols);
          uv[v * 2] = c / this.cols;
          uv[v * 2 + 1] = vr === 1 ? 0 : 1 - r / (vr - 1);
        }
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const ix = new Uint16Array((vc - 1) * (vr - 1) * 6);
      let k = 0;
      for (let r = 0; r + 1 < vr; r++) {
        for (let c = 0; c + 1 < vc; c++) {
          const a = r * vc + c, b = r * vc + c + 1, d = (r + 1) * vc + c, e = (r + 1) * vc + c + 1;
          // wound so the face normal points AWAY from the axis with the columns
          // running anticlockwise seen from above and the rows running down
          ix[k++] = a; ix[k++] = d; ix[k++] = b;
          ix[k++] = b; ix[k++] = d; ix[k++] = e;
        }
      }
      geo.setIndex(new THREE.BufferAttribute(ix, 1));
      this._seam = vc;                    // stride, for the normal weld
    } else {
      geo = new THREE.PlaneGeometry(this.width, this.length, this.cols - 1, this.rows - 1);
      this._vmap = null;
      this._seam = 0;
    }
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
    const vcols = this.closed ? this.cols + 1 : this.cols;
    const col = new Float32Array(vcols * this.rows * 3);
    for (let r = 0; r < this.rows; r++) {
      const t = this.rows === 1 ? 1 : r / (this.rows - 1);
      // dark at the collar where the cloth is bunched under its own pins,
      // opening out to full light by a fifth of the way down
      const v = 0.55 + 0.45 * clamp(t / 0.20, 0, 1);
      for (let c = 0; c < vcols; c++) {
        const i = (r * vcols + c) * 3;
        col[i] = col[i + 1] = col[i + 2] = v;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.attrCol = geo.attributes.color;
    /**
     * The base shade each vertex fades back to, kept so a live occlusion term
     * can be written over the top of the ramp instead of on top of itself.
     */
    this._col0 = col.slice();
    /**
     * Live fold occlusion.
     *
     * The rigid skirt this replaces baked its fold shadows into a vertex-colour
     * channel, because geometry alone gives a fold a lit side and a dark side
     * and only occlusion makes the BOTTOM of one read as a fold rather than as
     * a facet. Simulated folds move, so the bake cannot; this darkens each
     * vertex by how far it sits INSIDE its own row, which is the same signed
     * radial residual the fold metric is built on. 0 turns it off.
     */
    this.foldAO = opts.foldAO ?? 0;
    this.mat = opts.material || new THREE.MeshStandardMaterial({
      color: opts.color ?? 0x5a4530, roughness: 0.94, metalness: 0,
      side: THREE.DoubleSide,
    });
    /*
     * A ZERO-THICKNESS SHEET MUST NOT WRITE ITS OWN SHADOW-MAP DEPTH ON THE
     * SIDE THE NORMAL BIAS PUSHES AWAY FROM THE SUN.
     *
     * three picks the shadow pass's cull mode from `shadowSide[material.side]`
     * (WebGLShadowMap.getDepthMaterial), and that table maps FrontSide→BackSide
     * — the front-face-cull trick that makes a CLOSED mesh write its FAR
     * surface, metres behind the surface being shaded, so nothing can
     * self-shadow. DoubleSide maps to DoubleSide. Every garment here is
     * DoubleSide, because a cloak has to be visible from inside; so the depth
     * pass rasterises the very same sheet at the very same depth the lighting
     * pass then tests against. There is no far surface. It is textbook
     * self-shadow acne, and a hard cel step (CEL.shadowStep 0.5, shadowEdge
     * 0.045 — see src/toon/Cel.js) turns soft acne into a solid black blotch
     * with a dithered rim instead of into a faint stripe.
     *
     * The sign is what makes it catastrophic rather than merely noisy.
     * three offsets the shadow LOOKUP along the geometry normal by the light's
     * `normalBias` (shadowmap_vertex, `worldPosition + shadowWorldNormal *
     * shadowNormalBias`) — and it uses the raw geometry normal, NOT the
     * gl_FrontFacing-flipped one the fragment is shaded with. On the half of
     * the cloth whose geometry normal points AWAY from the sun that 2 cm
     * offset moves the sample DEEPER, straight into the sheet's own depth.
     * Measured with a JS twin of Engine.saberSoftShadow against the shipped
     * cascade-0 rig (radius 0.19 × shadowDist, near 1, far 4.2 × radius,
     * normalBias 0.02, bias -0.00015), as the fraction of pixels the cel step
     * calls "in cast shadow" on a sheet with nothing above it:
     *
     *   dot(N,sun)   -1.0   -0.9   -0.6   -0.2    +0.2   +0.6
     *   low         100%   100%    68%    54%     48%     3%
     *   medium      100%    98%    56%    51%     45%     0%
     *   high        100%    59%    38%    45%     38%     0%
     *
     * — i.e. every anti-sun-facing scrap of every cloak, skirt, sash and lek in
     * the game is between a quarter and ALL shadowed by itself, and the deeper
     * it faces away the more solid the blotch. Against CEL.shadowBand that is a
     * 3.33:1 darkening on a surface the frame has already decided is lit, which
     * is the "hard-edged solid black region on the hip with a stippled fringe"
     * an audit measured on the player at 3 m in full daylight.
     *
     * FrontSide, not BackSide. The obvious guess is BackSide — it is what works
     * for a closed mesh — and on a sheet it is exactly wrong: it keeps the
     * anti-sun faces (the 100% column above, unchanged) and culls the sun-facing
     * ones, which are the faces the light can actually see, so the garment stops
     * casting a shadow at all. With FrontSide the anti-sun half writes nothing,
     * so it cannot shadow itself (0% at every negative column above), while the
     * sun-facing half — the silhouette the light sees, which is the whole of the
     * cast shadow — still rasterises. Same reasoning and same value as
     * Terrain._buildMesh, which is the game's other single-sheet caster.
     *
     * What this does NOT fix, stated because the number is in the table: the
     * sun-facing half still speckles at grazing incidence (38% at dot 0.2 on
     * high) because one 2.23 cm texel of a sheet at 78° to the sun spans 10.9 cm
     * of depth against 2.2 cm of combined bias. That is slope-scale acne, it is
     * the same budget the terrain runs on and accepts, and it lands on the band
     * that is at the tone terminator anyway. It needs a per-material depth bias
     * three does not have; it is not a reason to keep writing the other half.
     *
     * Only set when the caller has not chosen, and only for the DoubleSide case
     * this reasoning is about — for a closed solid FrontSide and DoubleSide
     * write the same near hull, so this is never worse than what it replaces.
     */
    if (this.mat.shadowSide === null && this.mat.side === THREE.DoubleSide) {
      this.mat.shadowSide = THREE.FrontSide;
    }
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
    const centre = new THREE.Vector3();
    if (this.closed) {
      /*
       * A tube's centre is its AXIS, and the middle anchor of a ring is a point
       * ON the ring — sampling it the sheet's way put the centre 145mm off the
       * axis and turned every radial `spread` below into a translation. The
       * mean of the anchors is the axis for a ring and is the middle anchor to
       * within a millimetre for the cape's bowed collar, but the sheet keeps
       * its own path so nothing that ships today moves.
       */
      for (let c = 0; c < this.cols; c++) { this.anchorFn(c, this.cols, _v1, 0); centre.add(_v1); }
      centre.divideScalar(this.cols);
    } else {
      this.anchorFn((this.cols - 1) / 2, this.cols, _v4, 0);
      centre.copy(_v4);
    }
    for (let c = 0; c < this.cols; c++) {
      this.anchorFn(c, this.cols, _v1, 0);
      // the asymmetric cut: this column's share of the drop. 1 everywhere when
      // hemBias is 0, which is every garment that shipped before it existed.
      const bias = this.hemBias
        ? 1 + this.hemBias * Math.cos((c / this.cols) * Math.PI * 2 + this.hemPhase) : 1;
      for (let r = 0; r < this.rows; r++) {
        const t = (this.rows === 1 ? 0 : r / (this.rows - 1)) * bias;
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
        /*
         * A TUBE DOES NOT GATHER THE WAY A SHEET DOES, and running the sheet's
         * arithmetic on one is why the first closed cloth here fell in on
         * itself. A pinned sheet whose across rest lengths are shortened has
         * nowhere to put the surplus but sideways, so it buckles. A RING has:
         * it shrinks. Nothing in a closed loop of 14 particles resists a
         * uniform contraction — measured, the tube pulled in to 78mm of radius
         * under a 145mm waistband, rode 75mm UP its own anchor (a smaller cone
         * on the same slant is a taller cone), and was then launched vertically
         * by the axis-centred collider spheres it had collapsed on top of.
         *
         * What stops a real gathered skirt shrinking is the body inside it. So
         * on a closed cloth the layout is laid ON that surface — `profile`,
         * which for the skirt is the same table the cape collides against — and
         * the rest lengths are shortened BELOW it, which leaves the ring in
         * compression against something it cannot pass through. Then the only
         * way to take up the surplus is to buckle, which is a fold.
         *
         * `gather` is the sheet's compensation for fullness taking a cape in,
         * and it is exactly wrong here: at t=1 it is 1/fullness, so it cancels
         * the compression at the hem — the one row with the most cloth in it.
         */
        const gather = this.closed ? 1 : 1 + (1 / this.fullness - 1) * t * t;
        const base = this.profile ? this.profile(t)
          : 1 + this.flare * (this.flarePow === 2 ? t * t : Math.pow(t, this.flarePow));
        const spread = base * gather;
        const i = (r * this.cols + c) * 3;
        this.pos[i] = this.prev[i] = centre.x + (_v1.x - centre.x) * spread;
        // t·length is r·dropStep with the unbiased t — but only to within an
        // ulp, and a garment with no bias in it has to lay out BIT for bit as
        // it did before there was such a thing, so the shipped expression stays
        this.pos[i + 1] = this.prev[i + 1] = this.hemBias ? _v1.y - t * this.length
                                                          : _v1.y - r * dropStep;
        this.pos[i + 2] = this.prev[i + 2] = centre.z + (_v1.z - centre.z) * spread + t * t * this.lean;
      }
    }
    // A pinned particle sits where its anchor says, not where the layout put
    // it. Identical for a single pinned row (row 0's layout IS its anchor), and
    // the only thing that stops a second pinned row snapping on frame one.
    for (let r = 1; r < this.pinRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.anchorFn(c, this.cols, _v1, r);
        const i = (r * this.cols + c) * 3;
        this.pos[i] = this.prev[i] = _v1.x;
        this.pos[i + 1] = this.prev[i + 1] = _v1.y;
        this.pos[i + 2] = this.prev[i + 2] = _v1.z;
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
    /*
     * PLEATS.
     *
     * The lathe this replaces bakes three cosine harmonics into its section —
     * 7, 3 and 11 — and bakes their shadows into vertex colour. Those are not
     * numerical artefacts, they are the garment's CUT, and the honest way to
     * carry a cut into a cloth solve is as rest length: a column pair whose
     * rest is long stands proud, one whose rest is short pulls in. A cosine
     * round the ring sums to zero, so the pleat costs no circumference — it is
     * a fold and nothing else.
     *
     * This is not the baking that was complained about. The rigid version fixed
     * the folds in the PELVIS frame, where they could never move; a pleat is a
     * property of the fabric, and it opens, closes and travels with the body
     * like a real one.
     *
     * It also carries the whole fold budget on a tube, because `fullness`
     * cannot. Shortening the across rest on a ring does not leave the cloth
     * with surplus to buckle with; the ring adopts the matching radius, and
     * once it reaches the shell it cannot shrink any further, so every across
     * link ends up in TENSION over a surface it cannot pass through — which is
     * a taut garment, the exact thing being fixed. Measured on a standing Jedi
     * at pleat 0.24, on the shipped 700mm robe: fullness 1 wrinkles 23.7mm and
     * stands 26.2mm off the body, 0.86 gives 14.2 at 9.4mm off, and 0.75 gives
     * 4.2 at 0.4mm — the cloth is simply against the legs by then.
     *
     * (The reading that used to be quoted here was the ridge correlation, on
     * the 460mm version: 0.92 falling to 0.21. It does not mean what it says on
     * a garment this long. Once the ring is taut what is left is the SHELL
     * showing through, and a pair of legs is the same shape at every height, so
     * the 700mm robe reads ridge 0.98 while wrinkling 4mm. Coherence is not
     * folding. The standoff above is the same claim in a frame that does not
     * change meaning with the hem.)
     *
     * At a walk it costs drop as well — the hem at 0.86 sits 147mm higher than
     * at 1, because a narrower cone on the same slant is a taller one. So the
     * skirt runs no surplus at all and the folds are the pleat's.
     */
    const pl = this.pleat, ph = this.pleatHarm, phase = this.pleatPhase;
    for (const l of this.links) {
      const a = l.a * 3, b = l.b * 3;
      const d = Math.hypot(this.pos[a] - this.pos[b], this.pos[a + 1] - this.pos[b + 1], this.pos[a + 2] - this.pos[b + 2]);
      // rest0 is the taut length, kept so a test can ask whether the cloth is
      // still the size it was cut — `rest` alone cannot answer that once
      // jitter has made the rest lengths deliberately inconsistent.
      l.rest0 = d;
      let k = 1;
      if (l.across) {
        k = this.fullness;
        if (pl) {
          const th = ((l.a % this.cols) + 0.5) / this.cols * Math.PI * 2;
          k *= 1 + pl * Math.cos(ph * th + phase);
        }
      }
      l.rest = d * k * (1 + (noise() * 2 - 1) * this.jitter);
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

    // ── pin the anchored rows to the wearer. `pinRows` is 1 for a cape, so
    //    this is the loop that shipped; a waistband under a belt may want two.
    for (let r = 0; r < this.pinRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.anchorFn(c, this.cols, _v1, r);
        const i3 = (r * this.cols + c) * 3;
        p[i3] = _v1.x; p[i3 + 1] = _v1.y; p[i3 + 2] = _v1.z;
      }
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
        /*
         * A BAND, not a ball, when the collider carries an axis.
         *
         * A sphere cannot hold cloth on a surface that WIDENS DOWNWARD, and a
         * robe below a belt is exactly that. Every sphere big enough to keep a
         * particle off the hem is also a sphere whose centre is below that
         * particle, so its push has an upward component — and since a verlet
         * contact is read as a velocity next frame (see the note below), the
         * upward component is a ratchet. Measured on the sash: at 4.6 m/s the
         * tip finished level with its own root, and at 7.4 it finished 314mm
         * ABOVE it, having been walked up the robe one stride at a time.
         *
         * `up` + `h` make the collider a cylinder segment instead: the offset
         * is taken perpendicular to the axis, the push is perpendicular to the
         * axis, and the band ignores anything outside its own height. Stacked
         * one per row it is a lathe of the garment, and it has no opinion about
         * which way is up. Spheres are untouched — a collider with no `up` on
         * it takes the path it always did.
         */
        if (s.up) {
          const ux = s.up.x, uy = s.up.y, uz = s.up.z, h = s.h ?? 0;
          for (let i = 0; i < n; i++) {
            if (this.pinned[i]) continue;
            const i3 = i * 3;
            const dx = p[i3] - cx, dy = p[i3 + 1] - cy, dz = p[i3 + 2] - cz;
            const t = dx * ux + dy * uy + dz * uz;
            if (t > h || t < -h) continue;
            const ox = dx - ux * t, oy = dy - uy * t, oz = dz - uz * t;
            const d2 = ox * ox + oy * oy + oz * oz;
            if (d2 >= r * r || d2 < 1e-8) continue;
            const d = Math.sqrt(d2), k = (r - d) / d;
            p[i3] += ox * k; p[i3 + 1] += oy * k; p[i3 + 2] += oz * k;
          }
          continue;
        }
        // driven by `pinned` rather than by "everything past row 0", which was
        // an assumption about where the anchor is rather than a statement of
        // the rule — that a pinned particle is not the solver's to move
        for (let i = 0; i < n; i++) {
          if (this.pinned[i]) continue;
          const i3 = i * 3;
          const dx = p[i3] - cx, dy = p[i3 + 1] - cy, dz = p[i3 + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), k = (r - d) / d;
          /*
           * NOT carried into `prev`, though it looks as if it should be.
           *
           * In verlet a position correction IS an acceleration, so a collider
           * that moves fast hands the particle it ejects that speed — and the
           * inner shell measurably does pump the skirt: adding it took the hem
           * 124mm further up its own anchor at a sprint than the same garment
           * with no shell at all. The textbook answer is to carry the same
           * correction into `prev` so the contact changes position and not
           * velocity, and it was tried: it is far worse. Leaving the velocity
           * intact leaves the INWARD velocity that drove the particle into the
           * collider intact too, so it penetrates again next frame and never
           * settles — the worst vertical link went from 31% over its cut length
           * to 413% at a sprint, and the hem travelled 806mm instead of 168.
           * Losing the normal velocity on contact is what makes this converge.
           */
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
        // on a tube the across tangent wraps; clamping it at the seam gave the
        // two seam columns a half-width tangent and a normal tilted off it
        const cl = this.closed ? (c + cols - 1) % cols : Math.max(0, c - 1);
        const cr = this.closed ? (c + 1) % cols : Math.min(cols - 1, c + 1);
        const l = (r * cols + cl) * 3, rr = (r * cols + cr) * 3;
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
    const map = this._vmap;
    if (map) {
      // the tube: cols+1 vertex columns onto cols particles, the last one a
      // duplicate of the first
      for (let v = 0; v < map.length; v++) {
        const i3 = map[v] * 3;
        arr[v * 3] = p[i3]; arr[v * 3 + 1] = p[i3 + 1]; arr[v * 3 + 2] = p[i3 + 2];
      }
    } else {
      // PlaneGeometry vertex r=0 is the TOP row, which matches our layout
      for (let i = 0; i < this.cols * this.rows; i++) {
        arr[i * 3] = p[i * 3];
        arr[i * 3 + 1] = p[i * 3 + 1];
        arr[i * 3 + 2] = p[i * 3 + 2];
      }
    }
    this.attrPos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    if (this._seam) {
      /*
       * WELD THE SEAM NORMALS. The duplicated column carries only the faces on
       * its own side of the seam, so the two copies of one particle come out of
       * computeVertexNormals with different normals and the garment renders
       * with a hard lit line down it — the exact artefact the tube was built to
       * remove. Averaging the pair is `rows` vertices of work.
       */
      const nA = this.geometry.attributes.normal.array, vc = this._seam;
      for (let r = 0; r < this.rows; r++) {
        const a = (r * vc) * 3, b = (r * vc + vc - 1) * 3;
        let x = nA[a] + nA[b], y = nA[a + 1] + nA[b + 1], z = nA[a + 2] + nA[b + 2];
        const len = Math.hypot(x, y, z) || 1;
        x /= len; y /= len; z /= len;
        nA[a] = nA[b] = x; nA[a + 1] = nA[b + 1] = y; nA[a + 2] = nA[b + 2] = z;
      }
      this.geometry.attributes.normal.needsUpdate = true;
    }
    if (this.foldAO) this._writeFoldAO();
  }

  /**
   * Darken the cloth where it lies inside its own row.
   *
   * The rigid skirt baked its fold shadows in, because geometry alone gives a
   * fold a lit side and a dark side and only occlusion makes the bottom of one
   * read as a fold rather than as a facet. A simulated fold moves, so the bake
   * cannot follow it. The signed radial residual about each row's own centre is
   * exactly the quantity the fold metric measures, and it is already to hand.
   */
  _writeFoldAO() {
    const { cols, rows, pos: p, foldAO } = this;
    const arr = this.attrCol.array, base = this._col0, map = this._vmap;
    const vc = map ? cols + 1 : cols;
    for (let r = 0; r < rows; r++) {
      let cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < cols; c++) {
        const i3 = (r * cols + c) * 3;
        cx += p[i3]; cy += p[i3 + 1]; cz += p[i3 + 2];
      }
      cx /= cols; cy /= cols; cz /= cols;
      let mean = 0;
      for (let c = 0; c < cols; c++) {
        const i3 = (r * cols + c) * 3;
        mean += Math.hypot(p[i3] - cx, p[i3 + 1] - cy, p[i3 + 2] - cz);
      }
      mean = (mean / cols) || 1;
      for (let c = 0; c < vc; c++) {
        const i3 = (r * cols + (c % cols)) * 3;
        const d = Math.hypot(p[i3] - cx, p[i3 + 1] - cy, p[i3 + 2] - cz) / mean - 1;
        // only the valleys darken; a ridge is not brighter than flat cloth
        const k = 1 - foldAO * clamp(-d / 0.12, 0, 1);
        const v = (r * vc + c) * 3;
        arr[v] = base[v] * k; arr[v + 1] = base[v + 1] * k; arr[v + 2] = base[v + 2] * k;
      }
    }
    this.attrCol.needsUpdate = true;
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
    for (let i = 0; i < n; i++) {
      if (this.pinned[i]) continue;         // was "everything past row 0"
      const i3 = i * 3;
      const falloff = (Math.floor(i / this.cols) / this.rows) * strength;
      this.prev[i3] -= dir.x * falloff * speed;
      this.prev[i3 + 1] -= dir.y * falloff * speed;
      this.prev[i3 + 2] -= dir.z * falloff * speed;
    }
  }

  /**
   * CARRY THE WHOLE SHEET WITH A BODY THAT IS TURNING, and simulate only what
   * is left over.
   *
   * Verlet keeps velocity implicitly, as `pos − prev`, and both are in WORLD
   * space. That is fine while the wearer walks, because the pinned row moves a
   * few centimetres a frame and the free rows chase it — which is exactly what
   * a cape doing its job looks like. It is not fine when the body turns
   * through a whole revolution in half a second: the pinned row is teleported
   * to the other side of the wearer while every other particle stays where it
   * was, the solver reads that as an enormous velocity, and the constraint
   * pass cannot pull five hundred stretched links back in one frame. Measured
   * on the first air-dodge somersault, the cloak came out as two rigid planks
   * four metres long — a cape drawn as a diving board.
   *
   * The fix is the one every cloth system eventually grows: when the FRAME the
   * cloth lives in moves rigidly, move the cloth with it. Rotating `pos` and
   * `prev` by the same quaternion about the same pivot leaves their difference
   * — the velocity — rotated but unchanged in length, so the sheet keeps the
   * motion it had, expressed in the new frame, and the solver is left with
   * only the genuine lag to work on. That residual is what billows.
   *
   * Pinned particles are carried too. They will be overwritten by `anchorFn`
   * on the next update, but not carrying them would leave the pinned row a
   * frame behind the rest of its own sheet, which is a seam at the collar.
   */
  carry(quat, pivot) {
    const n = this.cols * this.rows;
    const p = this.pos, q = this.prev;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      _v1.set(p[i3] - pivot.x, p[i3 + 1] - pivot.y, p[i3 + 2] - pivot.z).applyQuaternion(quat);
      p[i3] = pivot.x + _v1.x; p[i3 + 1] = pivot.y + _v1.y; p[i3 + 2] = pivot.z + _v1.z;
      _v1.set(q[i3] - pivot.x, q[i3 + 1] - pivot.y, q[i3 + 2] - pivot.z).applyQuaternion(quat);
      q[i3] = pivot.x + _v1.x; q[i3 + 1] = pivot.y + _v1.y; q[i3 + 2] = pivot.z + _v1.z;
    }
  }

  setVisible(v) { this.mesh.visible = v; }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    if (!this._sharedMat) this.mat.dispose();
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  ROBE CUTS                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE CUTS.
 *
 * "Clothes" in the character creator were six colour palettes on one identical
 * garment, which is a paint job rather than a wardrobe. The solver's parameters
 * are the vocabulary of a garment's CUT — length, pleat, flare, how the fabric
 * bends, how heavy it hangs — so a cut is a named set of them, and switching
 * cuts changes what the robe DOES, not what colour it is.
 *
 * Every one of these was measured before it was written down, on the headless
 * bench the checks in tools/checks/garments.mjs re-derive: fold depth and ridge
 * correlation standing, hem travel in the pelvis frame at a walk, how deep the
 * cloth passes into a leg, ride-up and stretch at a sprint, and the cost. What
 * the measurements ruled out is recorded here too, because four of the obvious
 * ideas do not survive contact with a four-iteration solve:
 *
 *   MORE ROWS ARE WORSE, not better. At the shipped 460mm and 4.6 m/s, 6/7/8
 *   rows read 33 / 72 / 99 mm of cloth inside a leg and 15 / 21 / 47 % stretch:
 *   the finer the mesh the less each particle can be moved out of the way in
 *   four passes. A longer garment therefore does NOT get proportionally more
 *   rows; it gets the same seven at a coarser pitch, and measures better for it.
 *
 *   A GARMENT NARROWER THAN THE STRIDE CANNOT BE SOLVED. A hem drawn in to
 *   0.22m with the flare taken out — the "tight travelling coat" this set was
 *   supposed to contain — reaches 329% stretch at a sprint: the cloth is caught
 *   between the inner shell and a leg swinging outside it, and four iterations
 *   have no way to let it slide. The coat here is taken in through the hip and
 *   keeps its flare below the knee, which is as tight as the solver goes.
 *
 *   STIFFNESS DOES NOT BUY IT BACK. On that same coat, structural 0.82 → 0.97
 *   moved the p95 walk stretch from 110% to 103%. The stretch is contact, not
 *   compliance.
 *
 *   AND SHEAR IS NOT STIFFNESS. The obvious way to write a stiff duelling
 *   tabard is to raise every stiffness including the diagonals; at shear 0.5 it
 *   scores ridge 0.53 with 23% of its fold power at the per-column Nyquist —
 *   a rash rather than a garment. Stiffness for a tube belongs in `stiffness`,
 *   `bend` and `bendDown`; the diagonals stay soft or the folds stop running
 *   down the cloth. Same finding as the shipped skirt's own shear note.
 *
 * `id` is what the UI stores, and both `attachSkirt(scene, rig, { cut })` and
 * `attachCloak(scene, rig, { cut })` take it. The blurb is written for a
 * player, not for this file.
 *
 * The `cloak` half of each entry is FABRIC ONLY — how the cape damps, how much
 * air it catches, how it bends — because Player and Enemy both pass the cape's
 * width, length, cols, rows and flare explicitly and an explicit option beats a
 * preset. That is enough to be worth having: measured at a walk, the cassock's
 * cape trails 45mm less and hangs 27mm lower than the temple robe's and the
 * ceremonial's streams 39mm further back. If a caller ever stops pinning the
 * dimensions, put them here.
 */
export const ROBE_CUTS = [
  {
    id: 'temple', name: 'Temple Robe',
    blurb: 'The order\'s own cut. Knee-length over the under-robe, five soft pleats, and enough swing to read as cloth.',
    // Empty on purpose: this IS the shipped garment, and it has to stay the
    // thing every other cut is measured against.
    skirt: {}, cloak: {},
  },
  {
    id: 'cassock', name: 'Heavy Cassock',
    /* NOT "the longest cut the order allows", which is what this said while
     * the garment deploys 173.8 mm SHORTER than the default Temple Robe. The
     * length below is 0.54 against the robe's 0.70, and the note on it
     * explains why it is a ceiling rather than a preference: at 740 mm the
     * same 98 particles sample the cloth every 106 mm, against a shin 98 mm in
     * radius, and the drape fails. So the cut is short for a real reason and
     * the copy was describing a garment that was never built. What it IS is
     * the heaviest — the fold count and the settling time below are the two
     * things a player can actually see, and both are true. */
    blurb: 'Heavy enough to hang rather than fly. Four deep folds, and it is still moving a second after you have stopped.',
    skirt: {
      // 540mm, and that is the ceiling rather than a preference. See the note
      // on floor length below: at 740mm the same 98 particles sample the cloth
      // every 106mm and the shin it has to drape over is 98mm in radius.
      length: 0.54, cols: 14, rows: 7, shellStep: 0.065,
      // falls straight instead of belling — a cassock is a column
      petticoat: [[0.056, 0.145], [-0.04, 0.216], [-0.15, 0.234], [-0.26, 0.262],
                  [-0.37, 0.278], [-0.46, 0.278], [-0.58, 0.272]],
      pleat: 0.26, pleatHarm: 4, shear: 0.14,
      /*
       * HEAVY IS NOT MORE GRAVITY.
       *
       * The obvious spelling of a heavy garment is a bigger `gravity`, and it
       * was tried: at -16 this cut stretches a vertical link 54/51/45/46% over
       * its cut length at 4.2/4.6/5.0/7.4 m/s against 42/37/42/40% at the
       * shipped -13. In a verlet solve where every particle masses the same,
       * gravity is not weight, it is LOAD, and a chain's sag is load over
       * stiffness. There is no mass knob, and turning gravity up buys stretch.
       *
       * What heft actually is here: energy that goes and does not come back
       * (`damping` 0.952 against the shipped 0.972), a fabric that will not
       * answer the air (`lift` 0.55 and `drift` 0.45 against 1.0 and 0.7), and
       * a bend that holds its own line down the cloth (`bendDown` 0.80 against
       * 0.55). What that reads as, measured: the hem goes on moving for 1.48
       * seconds after the wearer stops dead, against 0.87 for the temple robe,
       * and travels 175mm a stride against its 194 on a garment 80mm longer.
       */
      damping: 0.952, lift: 0.55, drift: 0.45, bendDown: 0.80,
      foldAO: 0.62, proxyRows: [1, 3, 5, 6],
    },
    cloak: { damping: 0.952, lift: 0.6, drift: 0.5, bendDown: 0.80, fullness: 0.92 },
  },
  {
    id: 'tabard', name: 'Duelling Tabard',
    blurb: 'Short, stiff and belted twice. It sits above the knee and turns with the hips — nothing of it is between you and the floor.',
    skirt: {
      length: 0.30, cols: 12, rows: 5,
      petticoat: [[0.056, 0.145], [-0.04, 0.220], [-0.15, 0.235], [-0.26, 0.262]],
      /*
       * TWO PINNED RINGS, and they are the whole cut.
       *
       * `pinRows` has been a parameter since the tube landed and nothing used
       * it. A short garment is the case that wants it: the ride-up at a sprint
       * is close to a fixed 270-320mm whatever the garment's LENGTH, because it
       * is the inner shell pumping the cloth up its own cone rather than the
       * wind — switching the wind off leaves 236 of the temple robe's 274mm. So
       * a 300mm tabard on one ring finishes a sprint bunched at the belt, 80%
       * of its own length up its anchor. Held at a second ring 75mm down it
       * rides 66mm, which is 22%.
       *
       * That ring needed an anchor that reads its row index; see anchorFn.
       */
      pinRows: 2,
      pleat: 0.22, pleatHarm: 4, stiffness: 0.90, bend: 0.30, bendDown: 0.85,
      damping: 0.93, lift: 0.45, drift: 0.45, shellIn: 0.88,
      proxyRows: [1, 2, 3, 4],
    },
    cloak: { stiffness: 0.90, bendDown: 0.80, damping: 0.93, lift: 0.5, drift: 0.5, fullness: 0.94 },
  },
  {
    id: 'ceremonial', name: 'Ceremonial Robe',
    blurb: 'Six deep pleats in a great bell of cloth. Too much fabric to fight in, and every bit of it moves.',
    skirt: {
      length: 0.52, cols: 14, rows: 7,
      // 348mm at the hem against the temple robe's 267 — the widest the cape's
      // live proxy can be handed without the cape standing off the shoulders
      petticoat: [[0.056, 0.145], [-0.04, 0.235], [-0.15, 0.265], [-0.26, 0.305],
                  [-0.37, 0.335], [-0.48, 0.348], [-0.52, 0.348]],
      // six folds on fourteen columns: 2·6 < 14, so the mesh can still draw
      // them. Seven cannot — at harmonic 7 the power lands on the per-column
      // Nyquist and 82% of the wrinkle is a checkerboard.
      pleat: 0.42, pleatHarm: 6, shellIn: 0.82,
      /*
       * Light is not less gravity either — the mirror of the cassock's note.
       * At -11 this cut rides 346mm up its own anchor at a sprint against the
       * temple robe's 274; at the shipped -13 it rides 315 and loses nothing
       * that reads. Floating is `lift`, `drift` and `damping`: the air term is
       * what makes a light fabric behave like one, and this cut catches 35%
       * more of it than anything else in the wardrobe.
       */
      damping: 0.980, lift: 1.35, drift: 0.85, bendDown: 0.42,
      foldAO: 0.65, proxyRows: [1, 3, 5, 6],
    },
    cloak: { damping: 0.980, lift: 1.35, drift: 0.85, bendDown: 0.42, fullness: 0.82 },
  },
  {
    id: 'coat', name: 'Travelling Coat',
    blurb: 'Taken in at the hip and cut to the knee. It hangs close and creases rather than swings.',
    skirt: {
      length: 0.48, cols: 14, rows: 7, shellStep: 0.06,
      // in at the hip by 36mm, and it keeps its flare below the knee because a
      // hem narrower than the stride cannot be solved — see the note above
      petticoat: [[0.056, 0.145], [-0.04, 0.196], [-0.15, 0.208], [-0.26, 0.232],
                  [-0.37, 0.250], [-0.46, 0.252]],
      // three shallow creases rather than five folds: 13mm of wrinkle against
      // the temple robe's 25. `shear` 0.14 is what keeps them ridges — at the
      // skirt's own 0.20 this cut scores ridge 0.51 with 19% at Nyquist,
      // because a shallow pleat has nothing to spare for the diagonals to eat.
      pleat: 0.12, pleatHarm: 3, shear: 0.14,
      shellIn: 0.90, stiffness: 0.88, bendDown: 0.66,
      damping: 0.960, lift: 0.5, drift: 0.5, foldAO: 0.48,
      /*
       * FIVE proxy spheres, not four, and this is the only cut that needs a
       * fifth. The cape collides against this garment's own rows at their
       * widest point; on a cut taken in at the hip the cape settles further in
       * and finds the scallop between two of them — measured, 3.4mm of cape
       * inside the coat on 117 of 180 frames at the shipped [1,3,5,6] against
       * 0.0 on 0 of 180 at [1,3,4,5,6]. One more sphere against 99 cape
       * particles is 99 more sphere tests, which the cape's budget has.
       */
      proxyRows: [1, 3, 4, 5, 6],
    },
    cloak: { stiffness: 0.88, bendDown: 0.66, damping: 0.960, lift: 0.5, drift: 0.5, fullness: 0.95 },
  },
  {
    id: 'wrap', name: 'Wrapped Robe',
    blurb: 'Crossed over and caught at one hip: the hem falls to the calf on one side and clears the knee on the other, in four deep folds.',
    skirt: {
      length: 0.44, cols: 14, rows: 7, shellStep: 0.06,
      petticoat: [[0.056, 0.145], [-0.04, 0.220], [-0.15, 0.238], [-0.26, 0.268],
                  [-0.37, 0.288], [-0.48, 0.292], [-0.62, 0.288]],
      /*
       * THE ASYMMETRY: ±34% of the drop round the ring, which is a hem that
       * finishes 312mm lower on one side than the other and stays that way,
       * because the rest lengths are sampled off the biased layout — the long
       * side's columns really are cut 91% longer than the short side's. The
       * phase puts the long fall over one hip rather than down the back, where
       * it would read as a train on an otherwise symmetric garment.
       *
       * The rest of the cut exists because the first draft of it WAS the temple
       * robe with a slanted hem, and the wardrobe check said so: at 480mm on
       * the shipped fabric it separated from the temple robe on the slant and
       * on nothing else, which is the definition of a slider moved. Shorter, in
       * four deep folds instead of five soft ones, and freer down the cloth.
       */
      hemBias: 0.34, hemPhase: 2.0,
      // four folds and the deepest wrinkle in the wardrobe, at 27mm — a
      // crossed-over robe carries its cloth in a few big falls, not in a
      // gather, and it is also what separates this cut from the temple robe
      // on something other than the slant
      pleat: 0.24, pleatHarm: 4, shear: 0.14, bendDown: 0.60, damping: 0.968,
      proxyRows: [1, 3, 5, 6],
    },
    cloak: { bendDown: 0.60, damping: 0.968, fullness: 0.86 },
  },
];

const CUT_BY_ID = new Map(ROBE_CUTS.map((c) => [c.id, c]));
/** The cut with this id, or null — for a UI that wants to validate a choice. */
export function robeCut(id) { return CUT_BY_ID.get(id) || null; }

/**
 * Fill a cut's fields in UNDER whatever the caller asked for.
 *
 * Explicit options always win, because Player, Enemy and the sparring acolytes
 * pass their own material, scale and rigid meshes and a preset has no business
 * overwriting those. Written as an `undefined` test rather than a spread so an
 * option that is present-but-undefined — which is most of what attachSkirt
 * forwards — cannot blank a cut's value. No `cut` returns the caller's own
 * object untouched, so the default garment is not merely equal to the shipped
 * one, it is the same code path.
 */
function withCut(opts, part) {
  if (!opts.cut) return opts;
  const c = CUT_BY_ID.get(opts.cut);
  if (!c) return opts;                 // an unknown id wears the temple robe
  const out = { ...opts }, from = c[part] || {};
  for (const k in from) if (out[k] === undefined) out[k] = from[k];
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE WARDROBE — the garment is not ONE choice                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT A PLAYER MAY WEAR, PIECE BY PIECE.
 *
 * The report was "you can only change the lower robe, like you can't change
 * all the clothes… I want to be able to change all the clothes and also be
 * able to choose from different capes or even go capeless". That is exactly
 * what was there: `robeCut` chose the SKIRT's cut, `robeIndex` chose a palette
 * for the whole figure, and everything else on the body — the cape, the
 * over-panels on the chest, the belt's hanging ends, the boots, the gloves —
 * came out of `buildJedi` the same on every character in the game.
 *
 * The thirteen references in assets/reference/units/heroes/ are the argument
 * for splitting it, and they disagree with each other on nearly every layer:
 *
 *   CAPE          Dooku wears a floor-length one clasped at the throat;
 *                 Obi-Wan a travelling cloak to the calf; Plo Koon a short
 *                 shoulder mantle; Kit Fisto, Aayla Secura and Anakin (RotS)
 *                 wear none at all. Five different garments, and one of them
 *                 is the absence of a garment.
 *   OVER-PANELS   Obi-Wan's tabard falls past the knee; Anakin's stops at the
 *                 obi; Aayla and Kit Fisto have no over-layer on the torso at
 *                 all; Mace's is doubled front and back.
 *   BELT          the obi's ends hang long on Obi-Wan and Yoda, are absent on
 *                 Dooku (a plain buckled belt), and are two short falls on
 *                 Anakin.
 *   AND THE TONES do not move together. Anakin's tunic is near-black under a
 *                 dark leather tabard with SAND boots; Obi-Wan's is cream
 *                 under sand with brown boots and no gloves; Aayla wears one
 *                 tone head to foot. A single robe palette cannot say any of
 *                 that, which is why each piece here carries its own tone as
 *                 well as its own cut.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. Every piece below is either CLOTH (the
 * cape, the over-panels, the belt's ends) or a TONE on a material that
 * `buildJedi` already hands out. The pieces whose SHAPE is rigid geometry —
 * the tunic's collar and cuffs, the boot shafts, the bracers — can be
 * recoloured from here and cannot be recut from here; that needs geometry in
 * src/game/Bodies.js, and the handoff records exactly what.
 */

/**
 * THE CAPE, including not having one.
 *
 * `cloak` is the garment that ships, to the millimetre: Player._makeCloak
 * builds 0.36 × 0.86 m at 9 × 11 with flare 1.0, and those five numbers are
 * repeated here because they ARE this entry. tools/checks/preview.mjs reads
 * them back out of Player.js and compares them with the cape the preview
 * builds, so the two cannot drift apart in silence — which is the only reason
 * a second copy of them is safe.
 *
 * Every other row is measured against that one. `cell` is the area of one quad
 * of the weave (see tools/checks/_weave.mjs): no cut may dice its cloth finer
 * than the cape does, because a fine, small garment is the expensive kind and
 * "it is only a few particles" is the reasoning that check exists to refuse.
 *
 *      cut        w × l        grid    particles   cell
 *      none       —            —           0        —
 *      mantle     0.46 × 0.42  9 × 6      54       48 cm²
 *      cloak      0.36 × 0.86  9 × 11     99       39 cm²   ← what ships
 *      travel     0.40 × 1.06  9 × 11     99       48 cm²
 *      court      0.52 × 1.26  9 × 11     99       75 cm²
 *
 * so the three added cuts are all COARSER than the shipped cape and two of
 * them are the same particle count. The mantle is the only one that is
 * cheaper, and it is the one a player picks to be able to see their own legs.
 */
export const CAPE_CUTS = [
  {
    id: 'cloak', name: 'Jedi Cloak',
    blurb: 'The order\'s own: off the shoulders, past the hips, flared enough to catch a turn.',
    // Empty on purpose — this is the garment Player._makeCloak builds, and it
    // has to stay the thing every other cape is measured against. See withCape:
    // an entry with no `cape` block leaves the caller's own numbers alone.
  },
  {
    id: 'none', name: 'No cape',
    blurb: 'Capeless. Nothing behind the shoulders at all — the way half the Council fights.',
    none: true,
  },
  {
    id: 'mantle', name: 'Shoulder Mantle',
    blurb: 'A short fall of heavy cloth off the shoulders. It clears the hips, so nothing hides your stance.',
    // Wider at the collar and less than half as long: a mantle is a yoke, not
    // a cape, so it is cut across the shoulders rather than down the back. The
    // fabric is the cassock's — a mantle that fluttered would be a cape.
    cape: { width: 0.46, length: 0.42, cols: 9, rows: 6, flare: 0.35,
            damping: 0.952, lift: 0.55, drift: 0.45, bendDown: 0.80, fullness: 0.92 },
  },
  {
    id: 'travel', name: 'Travelling Cloak',
    blurb: 'To the calf and narrow at the throat, in the roughest cloth in the wardrobe. It hangs rather than flies.',
    cape: { width: 0.40, length: 1.06, cols: 9, rows: 11, flare: 0.85,
            damping: 0.960, lift: 0.5, drift: 0.5, bendDown: 0.66, fullness: 0.95 },
  },
  {
    id: 'court', name: 'Court Cape',
    blurb: 'Floor-length and wide at the collar. Too much cloth to be practical, which is the point of it.',
    // The widest and longest thing anyone wears, and the lightest fabric on
    // it: this is the cape that streams. flare 1.25 against the cloak's 1.0.
    cape: { width: 0.52, length: 1.26, cols: 9, rows: 11, flare: 1.25,
            damping: 0.980, lift: 1.35, drift: 0.85, bendDown: 0.42, fullness: 0.82 },
  },
];

const CAPE_BY_ID = new Map(CAPE_CUTS.map((c) => [c.id, c]));
/** The cape cut with this id, or null. Same contract as `robeCut`. */
export function capeCut(id) { return CAPE_BY_ID.get(id) || null; }

/**
 * THE OVER-PANELS — the tabard, and the two ways of not having one.
 *
 * `buildJedi` builds three rigid panels on the chest bone in the `over` cloth:
 * two down the front at ±0.315 rad and one across the back. They are welded to
 * the ribcage, which is right for a garment tucked into a belt and wrong for
 * one that falls past it — so the long cuts here HIDE the rigid pair (the
 * runtime hands them over as `rigid`, exactly as the skirt does) and hang
 * simulated cloth in their place.
 *
 * `temple` is the shipped figure and adds no cloth at all, which is what keeps
 * a fresh character's garment set at the 287 particles / 1466 links
 * tools/checks/cloth-cost.mjs pins.
 */
export const TABARD_CUTS = [
  { id: 'temple', name: 'Temple Tabard',
    blurb: 'The two short panels down the front, tucked into the obi. What the order issues.' },
  { id: 'none', name: 'No over-robe',
    blurb: 'Tunic and belt, nothing over them. Bare shoulders and a clean silhouette.',
    hideRigid: true },
  { id: 'long', name: 'Long Tabard',
    blurb: 'One broad panel from the shoulders past the knee, loose below the belt so it swings.',
    hideRigid: true, panels: ['front'], length: 0.74, width: 0.24 },
  { id: 'double', name: 'Doubled Tabard',
    blurb: 'Long panels front AND back, the way a Council master wears it. The heaviest cut here.',
    hideRigid: true, panels: ['front', 'back'], length: 0.74, width: 0.24 },
  { id: 'short', name: 'Duelling Tabard',
    blurb: 'A single panel that stops at the obi. Nothing of it can be caught by a knee.',
    hideRigid: true, panels: ['front'], length: 0.40, width: 0.26, rows: 5 },
];
const TABARD_BY_ID = new Map(TABARD_CUTS.map((c) => [c.id, c]));
export function tabardCut(id) { return TABARD_BY_ID.get(id) || null; }

/**
 * THE BELT — how much of the obi hangs, and whether any of it does.
 *
 * `ends` is attachSash's own parameter, in the hips bone's frame: `at` is the
 * knot, `w`/`d` the section of the strap (an ellipse 32 mm across and 9 thick
 * is a band; a circle is a rope), `len` the fall and `lean` the forward push
 * that puts the tip where the robe's surface already is on frame one.
 *
 * `obi` restates the shipped pair rather than leaving it empty, because
 * attachSash's default table is what a garment with NO belt cut gets — the
 * enemies — and a player picking "Knotted Obi" must get exactly those numbers
 * whether or not they arrive through this table. tools/checks/sash.mjs
 * measures the pair either way.
 */
export const SASH_CUTS = [
  { id: 'obi', name: 'Knotted Obi',
    blurb: 'Two ends off the knot, one long and one short. The knot every Jedi ties.',
    ends: [
      { at: [0.052, 0.030, 0.158], w: 0.032, d: 0.009, len: 0.34, lean: 0.085 },
      { at: [-0.050, 0.026, 0.156], w: 0.026, d: 0.008, len: 0.25, lean: 0.062 },
    ] },
  { id: 'none', name: 'Plain Belt',
    blurb: 'Buckled and nothing hanging. A belt that cannot be caught on anything.',
    ends: [] },
  { id: 'long', name: 'Long Fall',
    blurb: 'One end taken to the knee. It swings a half-beat behind the robe under it.',
    ends: [
      { at: [0.052, 0.030, 0.158], w: 0.034, d: 0.009, len: 0.52, lean: 0.11 },
      { at: [-0.050, 0.026, 0.156], w: 0.024, d: 0.008, len: 0.22, lean: 0.058 },
    ] },
  { id: 'double', name: 'Twin Falls',
    blurb: 'Both ends long and hung wide, one on each hip.',
    ends: [
      { at: [0.086, 0.028, 0.128], w: 0.030, d: 0.009, len: 0.46, lean: 0.10 },
      { at: [-0.086, 0.028, 0.128], w: 0.030, d: 0.009, len: 0.46, lean: 0.10 },
    ] },
  { id: 'short', name: 'Tucked Ends',
    blurb: 'Both ends cut short and tidy, clear of the thigh.',
    ends: [
      { at: [0.052, 0.030, 0.158], w: 0.030, d: 0.009, len: 0.19, lean: 0.048 },
      { at: [-0.050, 0.026, 0.156], w: 0.026, d: 0.008, len: 0.16, lean: 0.040 },
    ] },
];
const SASH_BY_ID = new Map(SASH_CUTS.map((c) => [c.id, c]));
export function sashCut(id) { return SASH_BY_ID.get(id) || null; }

/**
 * THE TONES A PIECE MAY BE DYED, and why they are not ROBE_COLORS.
 *
 * `ROBE_COLORS` (Bodies.js) is a PALETTE — three related tones, outer, inner
 * and trim, which the builder then ladders into five cloth materials so the
 * layers read apart at range. That is the right shape for "what is this robe
 * made of" and the wrong shape for "what colour are the boots": a piece wants
 * one flat answer, and picking it out of a three-tone palette would mean
 * choosing an over-robe in order to choose a glove.
 *
 * Eleven, chosen off the references rather than as a colour wheel: the cream
 * and sand of a temple tunic, the browns of worn leather, Anakin's near-black,
 * Dooku's oxblood-lined black, Aayla's tan, Plo Koon's slate, and the ivory a
 * Council master's over-robe is cut in. Index -1 is "as the robe", which is
 * what every piece ships as, so a player who never opens these rows has
 * EXACTLY the figure they had before they existed.
 */
export const GARMENT_TONES = [
  { name: 'Bone',      hex: 0xd9cdb4 },
  { name: 'Cream',     hex: 0xc9b894 },
  { name: 'Sand',      hex: 0xa88f66 },
  { name: 'Tan',       hex: 0x8a6a44 },
  { name: 'Leather',   hex: 0x5b422c },
  { name: 'Umber',     hex: 0x3c2c1e },
  { name: 'Soot',      hex: 0x22222a },
  { name: 'Slate',     hex: 0x465060 },
  { name: 'Ash',       hex: 0x7d8390 },
  { name: 'Oxblood',   hex: 0x5c1f22 },
  { name: 'Deep Olive', hex: 0x3d4a2c },
];

/**
 * THE WHOLE OF WHAT A CHARACTER IS WEARING, as one object.
 *
 * One object and not nine settings, for the reason `face` is one object in
 * ui/Menu.js: nine top-level keys would each need a line in the settings blob,
 * a reader declaration and a row in three checks, and the thing they describe
 * is a single choice a player makes on one screen. `-1` on a tone means "as
 * the robe" — the tone `buildJedi` derived from the chosen palette — so the
 * default below is the figure that shipped, piece for piece.
 */
export const WARDROBE = {
  cape: 'cloak',
  tabard: 'temple',
  sash: 'obi',
  capeTone: -1,
  tunicTone: -1,
  tabardTone: -1,
  sashTone: -1,
  bootTone: -1,
  gloveTone: -1,
};

const TONE_MAX = GARMENT_TONES.length - 1;
/**
 * Normalise anything that has ever been stored as a wardrobe.
 *
 * Same job and same shape as `characterSheet` in ui/Menu.js: a blob off disk
 * is not to be trusted, an id that no longer exists must fall back to the
 * shipped piece rather than leaving a character with no cape at all, and a
 * tone index out of range must clamp rather than index past the end of the
 * table. Pure, so the checks can drive it without a DOM.
 */
export function wardrobeOf(w) {
  const src = (w && typeof w === 'object') ? w : {};
  const id = (map, v, d) => (map.has(v) ? v : d);
  const tone = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(TONE_MAX, Math.round(v))) : -1);
  return {
    cape: id(CAPE_BY_ID, src.cape, WARDROBE.cape),
    tabard: id(TABARD_BY_ID, src.tabard, WARDROBE.tabard),
    sash: id(SASH_BY_ID, src.sash, WARDROBE.sash),
    capeTone: tone(src.capeTone),
    tunicTone: tone(src.tunicTone),
    tabardTone: tone(src.tabardTone),
    sashTone: tone(src.sashTone),
    bootTone: tone(src.bootTone),
    gloveTone: tone(src.gloveTone),
  };
}

/* ── dyeing a piece ──────────────────────────────────────────────────── */

const _c1 = new THREE.Color();

/**
 * DYE ONE MATERIAL WITHOUT LOSING THE CORRECTION ITS BAKE NEEDED.
 *
 * `MeshStandardMaterial` multiplies `color` by `map`, so the number an author
 * types is never the colour that renders — it is that colour times the bake's
 * mean albedo. Bodies.js's `lit()` divides the tint through by that mean and
 * records both halves on the material (`userData.authored`, `userData.mapMean`);
 * `note()` records them without correcting, because the armour bakes ARE the
 * paint. Two policies, and this function has to honour whichever one built the
 * material it is handed.
 *
 * It does that by reading the correction back off the material rather than by
 * restating either formula: the ratio between what `lit`/`note` was TOLD and
 * what it SET is the correction, per channel, whether or not the clamp bit. A
 * restated formula is the shape §2.4 of the handoff is about — an instrument
 * that repeats a rule eventually disagrees with it.
 *
 * The builder's own colour is kept on first dye and is what "as the robe"
 * restores, so putting a tone back is the value buildJedi produced and not a
 * recomputation of it.
 */
function dye(mat, hex) {
  if (!mat || !mat.color) return false;
  const u = mat.userData || (mat.userData = {});
  if (!u.wardrobe0) {
    u.wardrobe0 = { color: mat.color.clone(), authored: u.authored ? u.authored.slice() : null };
  }
  const base = u.wardrobe0;
  if (hex === null || hex === undefined) {           // "as the robe"
    mat.color.copy(base.color);
    if (base.authored) u.authored = base.authored.slice();
    return true;
  }
  const want = _c1.set(hex);
  const a = base.authored;
  const k = (c, x) => (a && x > 1e-4 ? c / x : 1);
  mat.color.setRGB(
    Math.min(1, want.r * k(base.color.r, a && a[0])),
    Math.min(1, want.g * k(base.color.g, a && a[1])),
    Math.min(1, want.b * k(base.color.b, a && a[2])));
  u.authored = [want.r, want.g, want.b];
  return true;
}

/** The tone at an index, or null for -1 / anything out of the table. */
export function garmentTone(i) {
  return (i >= 0 && i < GARMENT_TONES.length) ? GARMENT_TONES[i].hex : null;
}

/** Every mesh hung on these bones that is painted with `mat`. */
function meshesOn(rig, bones, mat) {
  const out = [];
  for (const name of bones) {
    const b = rig?.get?.(name);
    if (!b || !b.obj) continue;
    for (const child of b.obj.children) {
      if (child.isMesh && child.material === mat) out.push(child);
    }
  }
  return out;
}

/**
 * PUT THE CHOSEN TONES ON A FIGURE THAT IS ALREADY BUILT.
 *
 * Colour is the half of the wardrobe that needs no new geometry, and it is
 * also the half that cannot be done in the builder: `buildJedi` derives five
 * cloth tones from ONE palette, on purpose, so that the layers read apart at
 * range — and a player who wants Anakin's near-black tunic under a leather
 * tabard over sand boots is asking for three tones that no single palette
 * contains. So the palette stays the default and each piece may override it.
 *
 * THE LEATHER HAS TO BE SPLIT FIRST. `buildJedi` paints the gloves, the boots,
 * the bracers, the belt and its pouches with ONE material instance, which is
 * right for a figure with one leather colour and makes "brown boots, black
 * gloves" impossible — dyeing it dyes both. So the two sets are given clones
 * of it the first time either is dyed, and only then. A character who never
 * opens these rows keeps exactly the material count they always had.
 *
 * @param cloth  the live garments, whose materials are CLONES the builder
 *               never sees: the skirt's cloth, the cape's, the sash's straps
 *               and the over-panels'. Dyeing the palette alone would leave the
 *               robe below the belt the old colour — which is the largest
 *               thing on the figure.
 */
export function tintWardrobe(built, wardrobe, cloth = {}) {
  if (!built || !built.palette) return 0;
  const w = wardrobeOf(wardrobe);
  const P = built.palette;
  const rig = built.rig;
  let n = 0;
  const put = (mat, tone) => { if (dye(mat, garmentTone(tone))) n++; };

  put(P.tunic, w.tunicTone);
  // The over-robe: the panels on the chest, the shoulder mantles, the sleeve
  // hems — and the cloth below the belt, which is a clone of the same
  // material and is the biggest surface on the figure.
  put(P.over, w.tabardTone);
  if (cloth.skirt && cloth.skirt.mat) put(cloth.skirt.mat, w.tabardTone);
  for (const p of cloth.cape?.panels || []) put(p.mat, w.tabardTone);
  // The belt: the obi, the collar band, the boot strap and the bracer strap
  // are all `trim`, and the two hanging ends are the same band of cloth.
  put(P.trim, w.sashTone);
  for (const p of cloth.skirt?.sash?.parts || []) put(p.mat, w.sashTone);
  // The cape's own sheet. Its material is a clone of `outer` made per figure,
  // so this cannot leak onto the body under it.
  if (cloth.cape && cloth.cape.mat) put(cloth.cape.mat, w.capeTone);

  if (rig && P.leather) {
    const BOOTS = ['footL', 'footR', 'shinL', 'shinR'];
    const GLOVES = ['handL', 'handR', 'foreL', 'foreR'];
    const split = (key, bones, tone) => {
      if (tone < 0 && !built[key]) return;            // never dyed: nothing to do
      if (!built[key]) {
        built[key] = P.leather.clone();
        built[key].userData = { ...P.leather.userData, wardrobe0: undefined };
        for (const m of meshesOn(rig, bones, P.leather)) m.material = built[key];
      }
      put(built[key], tone);
    };
    split('_bootMat', BOOTS, w.bootTone);
    split('_gloveMat', GLOVES, w.gloveTone);
  }

  /*
   * …AND THE RIGID OVER-PANELS COME OFF for the cuts that replace them.
   *
   * The same swap `attachSkirt` does with the rigid robe: the panels are
   * hidden rather than deleted, because a builder this workstream does not own
   * made them and a cut that hangs nothing in their place — "No over-robe" —
   * has to be able to give them back. Found by MATERIAL rather than by index:
   * `over` on the chest bone is the two front panels and the back one, and
   * nothing else on that bone is painted with it.
   */
  if (rig && P.over) {
    const cut = TABARD_BY_ID.get(w.tabard);
    const show = !(cut && cut.hideRigid);
    for (const m of meshesOn(rig, ['chest'], P.over)) m.visible = show;
    // A tabard is what the mantle on the point of the shoulder belongs to as
    // well: it is the same cloth and the same layer, and leaving two of them
    // on a figure with "no over-robe" reads as an oversight rather than as a
    // choice.
    for (const m of meshesOn(rig, ['armL', 'armR'], P.over)) m.visible = show;
  }
  return n;
}

/**
 * Fill a cape cut's dimensions in under whatever the caller asked for.
 *
 * Exactly `withCut`'s contract and for exactly its reason — Player and Enemy
 * pass their own width, length and grid, and a preset has no business
 * overwriting a caller who was explicit. What that means in practice is that
 * a caller who wants a CUT must not also state the dimensions, which is why
 * the wardrobe seam passes `cape` and nothing else.
 */
function withCape(opts) {
  if (!opts.cape) return opts;
  const c = CAPE_BY_ID.get(opts.cape);
  if (!c || !c.cape) return opts;      // an unknown id, or the shipped cloak
  const out = { ...opts }, from = c.cape;
  for (const k in from) if (out[k] === undefined) out[k] = from[k];
  return out;
}

/**
 * NO CAPE AT ALL, as an object rather than as a null.
 *
 * `Player.update` steps the skirt INSIDE `if (this.cloak)` — the cape's
 * collider proxy is the skirt's own particles, so the two are stepped as a
 * pair — which means handing a capeless player a null cape would freeze their
 * robe solid, and the robe is the garment this whole file exists for. Measured
 * before this existed: with `p.cloak = null` the skirt's hem travels 0.0 mm in
 * the pelvis frame over seven seconds of walking, which is the rigid cone
 * again with extra steps.
 *
 * So "no cape" is a garment that answers every call a cape answers and draws
 * nothing. It carries `panels` because a tabard can outlive a cape — Kit Fisto
 * wears an over-panel and no cape — and those still have to be stepped.
 */
export function bareCape() {
  /*
   * Every method is a no-op and NOT "a loop over the panels", which was the
   * first cut of this and was wrong: `dressCape` wraps all five of these to
   * drive the panels, so a bare cape that also drove them would step every
   * over-panel twice a frame — two verlet integrations per frame is a garment
   * with twice the gravity and half the damping. `panels` is a field for the
   * census in tools/checks/cloth-cost.mjs to walk, not a list this object
   * owns.
   */
  return {
    none: true, outer: null, panels: [], enabled: false, initialised: true,
    colliders: [],
    refreshColliders() { return this.colliders; },
    update() {}, carry() {}, impulse() {}, setVisible() {}, dispose() {},
  };
}

/**
 * THE OVER-PANEL, as cloth hanging off the chest.
 *
 * It is the same argument the skirt made and then the sash made after it: the
 * panels `buildJedi` builds are welded to the ribcage, so they move zero
 * millimetres relative to it and a long one would read as a painted board on
 * a body that is running. A panel that falls past the belt has to be cloth or
 * it should not be long.
 *
 * A SHEET and not a tube, unlike everything else added to this file since the
 * cape: an over-panel has two free vertical edges and they are most of what
 * you see of it — the edge lifting off the thigh at the top of a stride is the
 * whole read. `fullness` therefore works here exactly as it works on the cape
 * (a tube would only shrink; see the note in reset()).
 *
 * @param opts.panels ['front'] or ['front','back'] — which sides to hang
 * @param opts.outer  the garment beneath, for collision (attachCloak's own
 *                    `outer`, i.e. the skirt, so the panel lies on the robe)
 */
export function attachTabard(scene, rig, opts = {}) {
  const S = opts.scale ?? 1;
  const chestB = rig.get('chest');
  if (!chestB || !opts.panels || !opts.panels.length) return null;
  const width = opts.width ?? 0.24;
  const length = opts.length ?? 0.74;
  const cols = opts.cols ?? 5;
  const rows = opts.rows ?? 7;
  const half = width * S * 0.5;
  /*
   * WHERE IT HANGS OFF THE RIBCAGE.
   *
   * The chest lathe is squashed to 0.76 on Z (buildJedi's `DEPTH`) over a
   * radius that reaches 0.19, so the front of a dressed chest is at about
   * 0.145 in the bone's own frame and the back at -0.145. 0.152 puts the top
   * row a centimetre proud of the cloth already there, which is where a
   * garment worn OVER the tunic starts. The height is the cape's collar
   * height — a tabard comes over the same shoulder — less a little, so the
   * two do not fight for the same particles at the neck.
   */
  const depth = opts.depth ?? 0.152;
  const top = opts.top ?? 0.86;
  const parts = [];
  for (const side of opts.panels) {
    const sz = side === 'back' ? -1 : 1;
    const panel = new Cloak(scene, {
      cols, rows,
      width: width * S,
      length: length * S,
      material: opts.material,
      color: opts.color ?? 0x5a4530,
      /*
       * Nearly parallel-sided, and stiff down its length. A tabard is a cut
       * strip of the same heavy cloth as the over-robe: it is not gathered, it
       * does not bell, and what it does do is stay in one plane while the body
       * under it moves. flare 0.16 is the small widening a panel gets from
       * hanging clear of the hips, not a bell.
       */
      flare: opts.flare ?? 0.16,
      lean: 0,
      fullness: opts.fullness ?? 0.94,
      jitter: opts.jitter ?? 0.05,
      stiffness: opts.stiffness ?? 0.90,
      shear: opts.shear ?? 0.30,
      bend: opts.bend ?? 0.14,
      bendDown: opts.bendDown ?? 0.78,
      bendStretchOnly: true,
      damping: opts.damping ?? 0.945,
      // Deaf to the air, like the sash and for the same reason: a doubled band
      // of over-cloth belted at the waist does not flutter, it swings.
      lift: opts.lift ?? 0.42, drift: opts.drift ?? 0.45,
      gravity: opts.gravity ?? -14,
      iterations: opts.iterations ?? 4,
      seed: opts.seed === undefined ? undefined : opts.seed + (sz > 0 ? 0 : 7),
      foldAO: opts.foldAO ?? 0.45,
      anchorFn: (c, n, out) => {
        const t = n === 1 ? 0.5 : c / (n - 1);
        _m.copy(chestB.obj.matrixWorld);
        // Mirrored on the back panel so both are laid out anticlockwise about
        // the body; a back panel built with the front's winding is a sheet
        // whose normals face into the ribs, and the fold occlusion inverts.
        out.set(lerp(-half, half, t) * sz, chestB.length * top, depth * S * sz);
        out.applyMatrix4(_m);
      },
    });
    panel._sharedMat = !!opts.material;
    panel.side = sz;
    parts.push(panel);
  }

  /*
   * WHAT A PANEL CAN HIT: the ribcage, the pelvis, and the robe under it.
   *
   * Three bones rather than the cape's seven — a panel hanging down the FRONT
   * cannot reach a shin, and a collider nothing touches is a sphere test paid
   * for four times a frame for the life of the character. The radii are the
   * cape's own list taken in by about 15 mm, because this layer sits under the
   * cape rather than over it and a panel held at the cape's radius stands off
   * its own tunic.
   */
  const bones = ['chest', 'spine', 'hips'];
  const radii = [0.176, 0.172, 0.188];
  for (const panel of parts) {
    panel.refreshColliders = () => {
      const out = panel.colliders;
      out.length = 0;
      for (let i = 0; i < bones.length; i++) {
        const b = rig.get(bones[i]);
        if (!b || b.severed) continue;
        b.obj.updateMatrixWorld(false);
        for (const t of [0.3, 0.85]) {
          _v3.set(0, b.length * t, 0).applyMatrix4(b.obj.matrixWorld);
          out.push({ c: _v3.clone(), r: radii[i] * S });
        }
      }
      // …and the live robe, if there is one. Same rule as the cape's: the
      // garment under this one moves 150 mm at a walk, so a table sampled off
      // where it used to be is a photograph.
      const live = opts.outer && opts.outer.proxy && opts.outer.proxy.length ? opts.outer.proxy : null;
      if (live) for (let i = 0; i < live.length; i++) out.push(live[i]);
      return out;
    };
  }

  return {
    parts,
    get initialised() { return parts.every((p) => p.initialised); },
    update(dt, wind) { for (const p of parts) if (p.enabled) p.update(dt, p.refreshColliders(), wind); },
    carry(quat, pivot) { for (const p of parts) if (p.enabled && p.initialised) p.carry(quat, pivot); },
    impulse(dir, strength, dt) { for (const p of parts) p.impulse(dir, strength, dt); },
    setVisible(v) { for (const p of parts) p.setVisible(v); },
    dispose() { for (const p of parts) p.dispose(); parts.length = 0; },
  };
}

/**
 * HANG THE OVER-PANELS ON THE CAPE, and let the cape drive them.
 *
 * The pattern is `attachSkirt`'s with the sash, verbatim, and it is worth
 * restating why it is the right one: `Player` and `Enemy` already call
 * `update`, `carry`, `impulse`, `setVisible` and `dispose` on a cape, in the
 * right order, on the right clock, inside the frame the chest they hang from
 * was posed in. A panel owned by the cape is driven by all five without a line
 * at any of those call sites — and neither of those two files is this
 * workstream's to edit.
 *
 * ONE THING IS NOT SHARED, and it is the first-person hide. Player calls
 * `cloak.setVisible(!firstPerson, false)` because a cape hangs where a
 * first-person camera cannot see it. A tabard hangs down the FRONT of the
 * chest, which is precisely what you look at when you look down, and hiding it
 * there would put the "hard cone under the clothes" complaint back in the one
 * view the game is mostly played in. So the panels follow the LOD call
 * (`standIn` true) and ignore the first-person one.
 */
function dressCape(cape, scene, rig, opts, S) {
  const cut = TABARD_BY_ID.get(opts.tabard);
  if (!cut || !cut.panels || !cut.panels.length) return cape;
  const tab = attachTabard(scene, rig, {
    scale: S, panels: cut.panels, length: cut.length, width: cut.width,
    rows: cut.rows, cols: cut.cols,
    material: opts.tabardMaterial, color: opts.tabardColor,
    seed: opts.seed, outer: null,
  });
  if (!tab) return cape;
  cape.panels = tab.parts;
  // The panel lies on the ROBE, and the cape learns which robe that is after
  // it is built (`cloak.outer = skirt`). Read through the cape on every
  // refresh rather than captured, so a skirt rebuilt under a live cape — which
  // is what changing the belt does — is the surface the panels then use.
  for (const p of tab.parts) {
    const refresh = p.refreshColliders;
    p.refreshColliders = () => {
      const out = refresh();
      const live = cape.outer && cape.outer.proxy && cape.outer.proxy.length ? cape.outer.proxy : null;
      if (live) for (let i = 0; i < live.length; i++) out.push(live[i]);
      return out;
    };
  }
  const _update = cape.update.bind(cape);
  cape.update = (dt, colliders, wind) => { _update(dt, colliders, wind); if (cape.enabled !== false || cape.none) tab.update(dt, wind); };
  const _carry = cape.carry.bind(cape);
  cape.carry = (q, pivot) => { _carry(q, pivot); tab.carry(q, pivot); };
  const _impulse = cape.impulse.bind(cape);
  cape.impulse = (dir, strength, dt) => { _impulse(dir, strength, dt); tab.impulse(dir, strength, dt); };
  const _setVisible = cape.setVisible.bind(cape);
  cape.setVisible = (v, standIn = true) => { _setVisible(v, standIn); tab.setVisible(standIn ? v : true); };
  const _dispose = cape.dispose.bind(cape);
  cape.dispose = () => { tab.dispose(); _dispose(); };
  cape.tabard = tab;
  return cape;
}

/**
 * Build a cloak that hangs from a rig's chest bone, with colliders tracking
 * the torso and legs so it drapes instead of clipping.
 *
 * @param opts.cape    a CAPE_CUTS id. Fills the dimensions in under whatever
 *                     the caller stated, and `none` returns a garment that
 *                     draws nothing — see bareCape.
 * @param opts.tabard  a TABARD_CUTS id. Its panels are owned by the cape the
 *                     way the sash is owned by the skirt, so the six calls
 *                     that already drive a cape drive them too.
 */
export function attachCloak(scene, rig, opts = {}) {
  opts = withCape(withCut(opts, 'cloak'));
  const capeless = CAPE_BY_ID.get(opts.cape)?.none;
  const S = opts.scale ?? 1;
  const chest = rig.get('chest');
  if (!chest) return null;
  if (capeless) return dressCape(bareCape(), scene, rig, opts, S);

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
    foldAO: opts.foldAO,
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
    /*
     * THE OUTER LAYER, LIVE IF THERE IS ONE.
     *
     * `skirt` above is a table sampled off a garment that could not move. Once
     * that garment is cloth, the table is a photograph of where it used to be:
     * the real thing swings 150mm at a walk and the cape settles against a
     * surface that stayed put. `cloak.outer` is any object with a `.proxy`
     * array of world spheres — attachSkirt fills one in from its own particles
     * every refresh — and it REPLACES the table rather than joining it, because
     * two inner surfaces at once is the wider of the two and the wider one is
     * whichever is stale.
     */
    const live = cloak.outer && cloak.outer.proxy && cloak.outer.proxy.length ? cloak.outer.proxy : null;
    if (live) {
      for (let i = 0; i < live.length; i++) out.push(live[i]);
    } else if (skirt && hipsB && !hipsB.severed) {
      hipsB.obj.updateMatrixWorld(false);
      for (let i = 0; i < skirt.length; i++) {
        _v3.set(0, skirt[i][0] * S, 0).applyMatrix4(hipsB.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: skirt[i][1] * S });
      }
    }
    return out;
  };
  return dressCape(cloak, scene, rig, opts, S);
}

/**
 * THE SKIRT. A closed tube of cloth on a waistband ring round the hips.
 *
 * The cape was the only simulated garment on the figure, and that is precisely
 * what made the rest of the costume read as a prop: five rigid lathe layers
 * parented to the `hips` bone, with the folds baked into the mesh section AND
 * into the vertex-colour occlusion, cannot move relative to the pelvis by one
 * micron — measured on a walking Jedi, a hem vertex travels 0.000 mm in the
 * pelvis frame over seven seconds while the cape's hem travels 217 mm beside
 * it. Nothing about the cape was wrong; it was standing next to a cylinder.
 *
 * This replaces the OUTER layer below the belt — the over-skirt and the two
 * front over-panels, 616 triangles of it — with 168 triangles of simulated
 * cloth. The under-robe stays rigid on purpose: it is the inner shell, it is
 * what the knee has to swing inside on a four-iteration solve, and it is the
 * collider the cloth drapes over. See `shell`.
 *
 * @param opts.rigid  meshes the rigid layer is made of; hidden while this is
 *                    live and shown again by setVisible(false) at LOD range.
 */
export function attachSkirt(scene, rig, opts = {}) {
  opts = withCut(opts, 'skirt');
  const S = opts.scale ?? 1;
  const hipsB = rig.get('hips');
  if (!hipsB) return null;

  /*
   * The waistband, in the hips bone's own frame.
   *
   * Sampled off the built robe rather than typed: the obi spans +0.020 to
   * +0.128 with its outer face at 0.147, and the rigid over-skirt is tucked at
   * r=0.142 and hung from +0.058 so the belt holds it. The ring goes at the
   * same radius and the same height, which is why swapping one for the other
   * does not move the waist.
   */
  // Everything below the waistband is in UNIT space — the tables are metres on
  // a 1.0-scale figure and `S` is applied once, where each of them reaches the
  // world. Scaling them here instead would put S into the shell twice, because
  // refreshColliders scales what it is handed.
  const waist = opts.waist ?? 0.145;
  const waistY = opts.waistY ?? 0.056;
  const cols = opts.cols ?? 14;
  /**
   * LONG ENOUGH TO REPLACE BOTH LAYERS.
   *
   * 0.46 was the OVER-skirt's length, and it was the right number while the
   * over-skirt was the only garment this replaced. It is not any more: the
   * under-robe — 0.72 m from the belt to the ankle — is handed out now too (see
   * Bodies.js), and cloth that stops at 0.46 would leave the legs bare from
   * mid-thigh down rather than clothed by a rigid cone. Trading one visible
   * fault for another is not a fix.
   *
   * 0.70 reaches where the under-robe reached. `rows` goes to 10 with it,
   * because 7 rows over 0.70 m is a 10 cm quad and the solver's bend
   * constraints stop reading as cloth at that spacing — the hem swings as one
   * plate instead of gathering.
   */
  const rows = opts.rows ?? 10;
  const length = opts.length ?? 0.70;

  /*
   * THE PETTICOAT — where the garment actually sits, in the hips frame.
   *
   * This is the table the cape already collides against, re-sampled last round
   * off a standing Jedi as the largest radius about the hips axis within 7cm of
   * each height. It described the rigid over-skirt's outer surface, and it is
   * the right shape for the cloth one for the same reason: it is the finished
   * silhouette of the outer garment, which is the surface a gathered skirt's
   * folds stand on. Used twice — as the layout profile the cloth is cut to, and
   * as the collider that stops the ring shrinking. Above the top row it is the
   * waistband itself; below the hem it is not consulted.
   */
  const petticoat = opts.petticoat ?? [
    [0.056, 0.145], [-0.04, 0.220], [-0.15, 0.235], [-0.26, 0.267],
    [-0.37, 0.292], [-0.42, 0.290],
    /**
     * …AND ON DOWN THE SHIN. The table described the over-skirt's outer
     * surface and stopped at its hem, which was correct while the cloth
     * stopped there too. Now that it reaches the ankle, a profile ending at
     * -0.42 leaves `radiusAt` returning the last entry for the bottom third —
     * a 29 cm-radius cylinder round the shins, which is the cone again wearing
     * a simulated coat.
     *
     * These follow the under-robe's own lathe: its swell peaks at t=0.45
     * (dy ≈ -0.30) and it tapers to a 0.230 hem, narrowing over the calf the
     * way a robe does rather than flaring like a bell.
     */
    [-0.50, 0.276], [-0.58, 0.258], [-0.66, 0.240], [-0.70, 0.232],
  ];
  const radiusAt = (dy) => {
    if (dy >= petticoat[0][0]) return petticoat[0][1];
    for (let i = 1; i < petticoat.length; i++) {
      if (dy >= petticoat[i][0]) {
        const t = (petticoat[i - 1][0] - dy) / (petticoat[i - 1][0] - petticoat[i][0]);
        return petticoat[i - 1][1] + (petticoat[i][1] - petticoat[i - 1][1]) * t;
      }
    }
    return petticoat[petticoat.length - 1][1];
  };

  const skirt = new Cloak(scene, {
    closed: true,
    cols, rows,
    length: length * S,
    // cut to the garment's own silhouette rather than to an exponent — see
    // `petticoat`. Divided by the waistband so the profile is a multiplier on
    // the anchor ring, which is what reset() wants.
    profile: opts.profile ?? ((t) => radiusAt(waistY - t * length) / waist),
    material: opts.material,
    color: opts.color ?? 0x4c3a26,
    // No surplus: on a closed ring a shortened across rest pulls the cloth taut
    // against the shell instead of buckling it — 24.8mm of wrinkle at 1 falls
    // to 4.5 at 0.75 — and costs 147mm of drop at a walk. See reset().
    fullness: opts.fullness ?? 1,
    pleat: opts.pleat ?? 0.24, pleatHarm: opts.pleatHarm ?? 5, pleatPhase: opts.pleatPhase,
    /*
     * Shear at 0.20, against the cape's 0.82.
     *
     * A vertical fold on a tube has to run from the waistband to the hem, and
     * what stops it is the diagonals: measured, at 0.82 the residual of one row
     * correlates 0.49 with the row below it — half the wrinkle is per-row noise
     * that happens to be deep. At 0.20 it is 0.93, which is a ridge. It also
     * makes the cloth LESS stretchy, not more: the worst vertical structural
     * link goes from 16% over its cut length to 8%, because a fold the
     * diagonals allow is a fold the structural links are not asked to pay for.
     */
    shear: opts.shear ?? 0.20,
    jitter: opts.jitter, lift: opts.lift, drift: opts.drift,
    stiffness: opts.stiffness, bend: opts.bend,
    bendDown: opts.bendDown, bendStretchOnly: opts.bendStretchOnly,
    damping: opts.damping, iterations: opts.iterations,
    gravity: opts.gravity ?? -13,
    seed: opts.seed, pinRows: opts.pinRows,
    hemBias: opts.hemBias, hemPhase: opts.hemPhase,
    foldAO: opts.foldAO ?? 0.55,
    /*
     * The waistband ring — and, for a cut that asks for one, the ring below it.
     *
     * `pinRows` has been a parameter since the tube landed and this function
     * handed it an anchor that ignored the row index, so both pinned rings came
     * out at the same height and the link between them had a rest length of
     * zero. The second ring belongs where the LAYOUT would have put it: down by
     * its share of the drop, at the radius the body has there. Row 0 is
     * untouched — `waist` rather than radiusAt(waistY), so a caller that moves
     * the waistband off the petticoat still gets the ring it asked for.
     */
    anchorFn: (c, n, out, r = 0) => {
      const th = (c / n) * Math.PI * 2;
      const bias = opts.hemBias
        ? 1 + opts.hemBias * Math.cos(th + (opts.hemPhase ?? 0)) : 1;
      const t = (rows > 1 ? r / (rows - 1) : 0) * bias;
      const dy = r === 0 ? waistY : waistY - t * length;
      const rad = r === 0 ? waist : radiusAt(dy);
      _m.copy(hipsB.obj.matrixWorld);
      out.set(Math.sin(th) * rad * S, dy * S, Math.cos(th) * rad * S);
      out.applyMatrix4(_m);
    },
  });
  skirt._sharedMat = !!opts.material;

  /*
   * THE INNER SHELL — the under-robe, which is still rigid and still there.
   *
   * Sampled off the built garment the same way the cape's table was: max radius
   * about the hips axis within 4cm of each height, in the hips frame.
   *
   *      dy      r      what it is
   *    +0.01   0.132    the tuck under the obi
   *    -0.07   0.161
   *    -0.15   0.180
   *    -0.23   0.196
   *    -0.31   0.222    the swell the knee swings inside
   *    -0.39   0.226
   *    -0.47   0.230
   *
   * Spaced 8cm apart at radii over twice that, so consecutive spheres overlap
   * and the cloth cannot dip between them — the deepest scallop between two of
   * them is 4mm.
   */
  /*
   * ...and the same table again as a collider, pulled IN by `shellIn`.
   *
   * Set flush with the layout the cloth is welded to it: every across link is
   * permanently stretched over a surface it cannot pass through, which is a
   * taut garment held up by its collision response — the board this whole
   * exercise is about. The gap is the room the folds live in, and it is what
   * lets a swinging knee dent the outside of the robe.
   *
   * Measured standing, at pleat 0.24 and shear 0.20: 0.95 gives 6.4mm of fold
   * amplitude, 0.90 gives 12.1, 0.84 gives 15.9 and 0.80 gives 18.0 — against
   * the ±up-to-28mm the rigid lathe bakes into its section. Past 0.78 the mean
   * radius starts falling away from the garment it stands in for.
   */
  const shellIn = opts.shellIn ?? 0.80;
  /*
   * ...spaced by `shellStep`, which a long cut has to be able to open out.
   *
   * The shell is one sphere every 55mm of drop, and the cost gate is particles
   * × colliders: a 540mm cassock on the shipped spacing carries 10 shell
   * spheres against the temple robe's 8 and pays 1764 sphere tests a pass
   * instead of 1568. What the 55mm buys is overlap — the scallop the cloth can
   * dip into between two spheres of radius r spaced s apart is r − √(r² − s²/4),
   * which at 55mm on a 210mm shell is 1.8mm and at 65mm is 2.5mm, both inside
   * the 4mm the original table was sized for. So the long cuts step 60-65mm and
   * cost the shipped 16 colliders.
   */
  const shellStep = opts.shellStep ?? 0.055;
  const shell = opts.shell === false ? null : (opts.shell ?? (() => {
    const t = [];
    for (let dy = waistY - 0.03; dy > waistY - length; dy -= shellStep) t.push([dy, radiusAt(dy) * shellIn]);
    return t;
  })());
  /*
   * The legs, which leave the shell.
   *
   * The under-robe is welded to the pelvis, so a swinging knee travels straight
   * through it and the cloth over it has to know. These are the leg bones only:
   * the cape's list starts at the chest because a cape hangs from the shoulders,
   * and a waistband has nothing to say about a ribcage.
   */
  const bones = opts.legs === false ? [] : ['thighL', 'thighR', 'shinL', 'shinR'];
  const radii = [0.115, 0.115, 0.098, 0.098];

  /**
   * A live stand-in for this garment, for whatever hangs OVER it.
   *
   * Four spheres, one per sampled row, at that row's own centre and its own
   * mean radius. The cape's collider list used a fixed table of where the rigid
   * skirt used to be; this is where the cloth one actually is this frame. Cost
   * is one pass over the particles — cheaper than the sphere tests it feeds.
   */
  skirt.proxy = [];
  const proxyRows = opts.proxyRows ?? [1, 3, 5, 6];
  const _refreshProxy = () => {
    const p = skirt.pos, out = skirt.proxy;
    out.length = 0;
    for (let k = 0; k < proxyRows.length; k++) {
      const r = Math.min(proxyRows[k], rows - 1);
      let cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < cols; c++) {
        const i3 = (r * cols + c) * 3;
        cx += p[i3]; cy += p[i3 + 1]; cz += p[i3 + 2];
      }
      cx /= cols; cy /= cols; cz /= cols;
      /*
       * The row's WIDEST point, not its mean.
       *
       * A sphere at the mean radius sits inside every ridge on the garment, and
       * a cape pushed off it settles inside the cloth: measured on a standing
       * Jedi, mean-radius proxies let the cape 33.8mm into the skirt's own
       * surface against 18.1mm for the fixed table it replaces. The table wins
       * because it was sampled as a MAX. Same rule here.
       */
      let rad = 0;
      for (let c = 0; c < cols; c++) {
        const i3 = (r * cols + c) * 3;
        rad = Math.max(rad, Math.hypot(p[i3] - cx, p[i3 + 1] - cy, p[i3 + 2] - cz));
      }
      out.push({ c: new THREE.Vector3(cx, cy, cz), r: rad });
    }
    return out;
  };
  skirt.refreshProxy = _refreshProxy;

  skirt.refreshColliders = () => {
    const out = skirt.colliders;
    out.length = 0;
    for (let i = 0; i < bones.length; i++) {
      const b = rig.get(bones[i]);
      if (!b || b.severed) continue;
      b.obj.updateMatrixWorld(false);
      for (const t of [0.25, 0.8]) {
        _v3.set(0, b.length * t, 0).applyMatrix4(b.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: radii[i] * S });
      }
    }
    if (shell && !hipsB.severed) {
      hipsB.obj.updateMatrixWorld(false);
      for (let i = 0; i < shell.length; i++) {
        _v3.set(0, shell[i][0] * S, 0).applyMatrix4(hipsB.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: shell[i][1] * S });
      }
    }
    if (skirt.initialised) _refreshProxy();
    return out;
  };

  /*
   * THE LOD SWAP, in one call.
   *
   * The cape is switched off past lod > 1 and so is this — but a cape that is
   * off leaves a character with no cape, and a skirt that is off would leave one
   * with a bare pelvis. So the rigid layer this stands in for is not deleted at
   * build time, only hidden: at range the 616 triangles come back and the
   * simulation stops. `rigid` is whatever Bodies.js built.
   */
  const rigid = opts.rigid || [];

  /*
   * THE SASH, carried by the skirt rather than by the caller.
   *
   * The obi's two hanging ends belong to the same garment and to the same
   * frame: they root on the belt this skirt is pinned to, and the only surface
   * they can lie on is this skirt's own. Owning them here means the six places
   * that already drive a skirt — update, carry, impulse, setVisible, dispose,
   * and the first-person hide — drive them too, without a line at any of them.
   * `sash: false` turns them off for a garment that has no belt.
   */
  /*
   * `sash` is now a CUT ID as well as a `false`, so a belt travels the way a
   * robe cut does — see SASH_CUTS. `false` still means "this garment has no
   * belt at all", which is what an enemy in a bodysuit passes; a cut whose
   * `ends` list is empty is a belt with nothing hanging off it, which is a
   * choice a player makes and not the absence of a belt. Those are two
   * different statements and they happen to build the same thing.
   */
  const sashPick = typeof opts.sash === 'string' ? SASH_BY_ID.get(opts.sash) : null;
  const sashEnds = opts.sashEnds ?? (sashPick ? sashPick.ends : undefined);
  const sash = (opts.sash === false || (sashEnds && !sashEnds.length)) ? null
    : attachSash(scene, rig, { scale: S, outer: skirt, material: opts.sashMaterial,
      color: opts.sashColor, seed: opts.seed, ends: sashEnds,
      // The cut's OWN profile, not a copy of the default: a cassock is a column
      // and a duelling tabard stops at the thigh, and a sash clamped to the
      // wrong silhouette hangs off the garment it is on.
      petticoat });

  const _update = skirt.update.bind(skirt);
  skirt.update = (dt, colliders, wind) => {
    _update(dt, colliders, wind);
    if (!sash || !skirt.enabled) return;
    /* The sash lies on the skirt, so it is stepped AFTER it — and it samples
     * this object's PARTICLES rather than `proxy`, which is the cape's list and
     * is not this one's to refresh. Poking it here read as the cape sinking
     * 2.6mm into the coat: the cape's colliders are taken before the skirt
     * solves, on purpose, and a second refresh handed it a surface half a solve
     * newer than the one its own step was written against. */
    sash.update(dt, wind);
  };
  const _carry = skirt.carry.bind(skirt);
  skirt.carry = (quat, pivot) => { _carry(quat, pivot); sash?.carry(quat, pivot); };
  const _impulse = skirt.impulse.bind(skirt);
  skirt.impulse = (dir, strength, dt) => { _impulse(dir, strength, dt); sash?.impulse(dir, strength, dt); };

  skirt.sash = sash;
  /**
   * @param v        is the simulated garment on?
   * @param standIn  when it is off, does the rigid layer come back in its
   *                 place? TRUE for the LOD swap, which is what this call was
   *                 written for — a character at range needs a skirt of some
   *                 kind and 616 static triangles are the cheap one.
   *
   * FALSE IS FIRST PERSON, AND ITS ABSENCE WAS THE OLDEST BUG ON THE LIST.
   *
   * `Player._pose` called `setVisible(!firstPerson)`, so looking through your
   * own eyes turned the cloth off and, by the line below, turned the rigid
   * layer ON. The player's report was "a hard cone under the clothes, visible
   * when jumping, hides the legs" — reported repeatedly, fixed in third person,
   * and still exactly true in the view where most of the game is spent.
   * Measured on a real player: four meshes and 904 triangles are shown ONLY in
   * first person and nothing at all is hidden, and the under-robe's hem
   * travels 0.0 mm in the pelvis frame across a jump while the knee travels
   * 1474 mm.
   *
   * Two different intents were sharing one flag: "swap to the cheap version"
   * and "do not draw this at all". The LOD wants the first. A camera inside
   * the head wants the second — or better, wants the CLOTH, which is what
   * Player now asks for: all 140 particles sit below the eye and the nearest
   * is 0.665 m from it, against a 0.045 m near plane, so there is nothing for
   * a robe to clip into.
   */
  skirt.setVisible = (v, standIn = true) => {
    skirt.mesh.visible = v;
    sash?.setVisible(v);
    for (let i = 0; i < rigid.length; i++) rigid[i].visible = !v && standIn;
  };
  skirt.setVisible(true);
  const _dispose = skirt.dispose.bind(skirt);
  skirt.dispose = () => {
    for (let i = 0; i < rigid.length; i++) rigid[i].visible = true;
    sash?.dispose();
    // A cape still holding `outer` on a disposed skirt would collide against
    // the last frame this garment ever ran. Empty means "fall back to the
    // table", which is where the rigid layer is again.
    skirt.proxy.length = 0;
    _dispose();
  };
  return skirt;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SASH — the obi's two hanging ends                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The ends of the belt, as cloth.
 *
 * THE BUG. Bodies.js built these as two rigid straps off the belt knot, with
 * the comment "the hanging ends are the point: a closed ring round a waist is a
 * hoop, and every reference for this character has cloth falling off the front
 * of the belt". They were welded to the hips at a radius of 116-147mm and the
 * garment over them reaches 220mm by the first row and 285 at the hem — so
 * measured on a built Jedi, 0 of 90 vertices were outside the robe and the
 * deepest sat 134mm inside it. The ends the comment calls the point rendered
 * nothing. Not one pixel, at any range, on any character in the game.
 *
 * WHY THEY CANNOT SIMPLY BE MOVED OUT. There is no radius that works. Under the
 * cloth robe the surface they would have to clear swings 150mm at a walk, so a
 * rigid strap outside it at rest is inside it a third of a second later; and a
 * strap far enough out to clear the swing is a plank hanging in the air beside
 * a moving garment, which is the exact defect — "a hem vertex travels 0.000 mm
 * in the pelvis frame while the cape's travels 217" — that put the robe in this
 * file in the first place. A strap that lies on cloth has to be cloth.
 *
 * SO: two narrow closed tubes on the belt, colliding against the skirt's live
 * proxy, which is the same surface the cape already rides. They are stepped by
 * `attachSkirt` after the skirt solves, so the thing they lie on is this
 * frame's garment rather than last frame's.
 *
 * THE RIGID PAIR IS DELETED, not hidden. Every other simulated garment here
 * keeps a rigid stand-in for LOD range, and each of those has a reason: a
 * missing skirt is a bare pelvis, a missing lek is a human. `lod > 1` is 62 m,
 * where a 30 mm strap subtends 0.45 px on a 1080p frame at this FOV — the cape
 * is switched off there for the same reason, and it does not keep a stand-in
 * either. Deleting them saves 90 vertices and 128 triangles on every robed
 * character, which is more than the 80 the simulated pair draws.
 *
 * @param opts.outer  the garment they lie on — anything with a `.proxy` array
 *                    of world spheres. attachSkirt passes itself.
 * @param opts.ends   [{ at:[x,y,z], w, d, len, lean }] in the hips bone's frame
 */
export function attachSash(scene, rig, opts = {}) {
  const S = opts.scale ?? 1;
  const hipsB = rig.get('hips');
  if (!hipsB) return null;
  const cols = opts.cols ?? 4;
  const rows = opts.rows ?? 6;

  /**
   * WHERE THEY HANG, and how far out they start.
   *
   * `at` is the knot, 158mm proud of the hips axis — the obi's own outer face
   * is at 147 and the cloth waistband is pinned at 145, so this is the first
   * radius that is outside both rather than between them.
   *
   * `lean` is the layout's forward push at the tip, and it is not decoration:
   * reset() lays a closed cloth out straight down from its ring, which for a
   * strap on a belled skirt means laid out INSIDE the garment and shoved out by
   * the colliders on frame one — a visible pop the first time a character is
   * drawn. 0.085 puts the tip where the robe's own surface is at that height,
   * so the first frame is already the settled one.
   *
   * Two different lengths, because a knot ties with a long end and a short one
   * and two identical straps read as a costume detail nobody looked at.
   */
  const ends = opts.ends ?? [
    { at: [0.052, 0.030, 0.158], w: 0.032, d: 0.009, len: 0.34, lean: 0.085 },
    { at: [-0.050, 0.026, 0.156], w: 0.026, d: 0.008, len: 0.25, lean: 0.062 },
  ];

  const mat = opts.material
    ? (opts.material.side === THREE.DoubleSide ? opts.material
      : Object.assign(opts.material.clone(), { side: THREE.DoubleSide }))
    : null;

  const parts = [];
  for (let k = 0; k < ends.length; k++) {
    const e = ends[k];
    const strap = new Cloak(scene, {
      closed: true,
      cols, rows,
      length: e.len * S,
      /* Parallel-sided. `flare` defaults to 0.85 and a sash that bells out to
       * 1.85× its own width at the tip is a pennant. */
      flare: 0,
      lean: (e.lean ?? 0) * S,
      material: mat,
      color: opts.color ?? 0x6b4f30,
      /* No surplus and no pleat, for the reason the lekku give: on a CLOSED
       * cloth a shortened across-rest does not buckle into a fold, it shrinks
       * the ring — and a strap that has pulled its own section in is a string. */
      fullness: 1, pleat: 0,
      /* Heavier and stiffer down its length than the robe it lies on. A sash
       * end is a doubled band of the same cloth as the belt, so it swings as a
       * unit and arrives; the robe under it ripples and this does not. */
      stiffness: 0.90, shear: 0.60, bend: 0.12, bendDown: 0.62,
      bendStretchOnly: true,
      /*
       * HEAVIER AND DEAFER TO THE AIR than the robe it lies on.
       *
       * 0.30/0.45 against the cape's 1.0/0.7, and damping at the cassock's 0.93
       * rather than the cape's 0.972: a doubled band of belt cloth swings and
       * arrives, and it does not catch the wind the way a metre of cape does.
       * Measured, the tip travels 84-109mm a stride at every speed from a walk
       * to a sprint and settles dead still when the wearer stops, which is the
       * pair of things a strap has to do.
       */
      damping: 0.93, lift: 0.30, drift: 0.45,
      gravity: opts.gravity ?? -15,
      iterations: opts.iterations ?? 4,
      jitter: 0,
      seed: opts.seed === undefined ? undefined : opts.seed + k,
      foldAO: opts.foldAO ?? 0.35,
      anchorFn: (c, n, out) => {
        /* A FLAT ring, not a round one. `spread` in reset() scales the anchor
         * radially about its own centre, so whatever section the ring is cut
         * in is the section the whole strap keeps — an ellipse 32mm across and
         * 9mm thick is a band, and a circle of either radius is a rope. */
        const th = (c / n) * Math.PI * 2;
        _m.copy(hipsB.obj.matrixWorld);
        out.set(e.at[0] * S + Math.sin(th) * e.w * S,
          e.at[1] * S,
          e.at[2] * S + Math.cos(th) * e.d * S);
        out.applyMatrix4(_m);
      },
    });
    strap._sharedMat = !!mat;
    parts.push(strap);
  }

  /**
   * WHAT A SASH END CAN HIT: the garment under it, and nothing else.
   *
   * NOT `outer.proxy`. That list is what the CAPE rides, and a cape reaches the
   * skirt at a glance near its hem; a sash lies flat on it for its whole
   * length, which is a far harder thing to ask of four spheres. Two ways it is
   * too coarse here, both measured on a walking Jedi:
   *
   *   its four rows are 155mm apart over a garment whose folds are 25mm deep,
   *   and an axis-centred sphere loses radius as sqrt(r² − dy²) away from its
   *   own height, so the strap sags into the gap between them;
   *
   *   and each sphere's radius is the row's widest 3-D offset from its own
   *   centroid, so a row with any vertical spread in it — every row, once the
   *   garment is moving — reports a radius it does not have horizontally
   *   anywhere, and holds the strap off the cloth.
   *
   * So the sash builds its own: one BAND per skirt row, radius = the largest
   * HORIZONTAL radius in that row. Per row closes the gap; horizontal-only
   * stops the vertical spread inflating it; a band rather than a ball stops the
   * push having an upward component. Sampled once a frame and shared by both
   * straps, and only down to the rows the longest of them can reach.
   *
   * AND THEN FLOORED AND CAPPED BY THE GARMENT'S REST SILHOUETTE, which is the
   * part that took three tries. A sampled surface is only as good as the shape
   * it is sampled from, and at a sprint the robe is not a solid of revolution at
   * all — it streams to a 725mm radius behind the wearer and 50mm in front, and
   * both naive readings fail there in opposite directions:
   *
   *   a max over the FRONT SECTOR collapses, because the front of the garment
   *   has left. The bands shrink to the stragglers near the axis, the strap
   *   falls through the body, and at 7.4 m/s it came out at 153° with a 117mm
   *   radius;
   *
   *   a max over the WHOLE RING explodes, because the streaming tail is in the
   *   same row as the front. The bands become 725mm cylinders, the strap is
   *   inflated out to a 400mm radius and pinned there — measured, the tip
   *   finished 74mm below its own root instead of 300, and stayed there at
   *   every fabric setting tried, because at that point it is the collider and
   *   not the cloth deciding where the thing hangs.
   *
   * `petticoat` is the garment's own cut profile — the table attachSkirt lays
   * the cloth out on, so a cassock's column and a duelling tabard's short bell
   * each clamp to themselves. Taking the ring max and clamping it to
   * [profile, 1.6 × profile] keeps the live ridge while it is a ridge and falls
   * back to the cut when the garment stops being a lathe. 1.6 is above the 1.14
   * the robe reaches swinging at a walk and well under the 2.5 a sprint throws.
   */
  const table = opts.petticoat ?? [
    [0.056, 0.145], [-0.04, 0.220], [-0.15, 0.235], [-0.26, 0.267], [-0.37, 0.292],
  ];
  const profileAt = (dy) => {
    if (dy >= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (dy >= table[i][0]) {
        const t = (table[i - 1][0] - dy) / (table[i - 1][0] - table[i][0]);
        return table[i - 1][1] + (table[i][1] - table[i - 1][1]) * t;
      }
    }
    return table[table.length - 1][1];
  };
  const outer = opts.outer ?? null;
  const reach = ends.reduce((a, e) => Math.min(a, e.at[1] - e.len), 0);
  const SWELL = opts.swell ?? 1.6;
  const surface = [];
  const _inv = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _up = new THREE.Vector3();
  let stamp = -1, frame = 0;

  /** The robe's outer surface, as a stack of bands, once a frame for the pair. */
  const resample = () => {
    if (!outer || !outer.initialised || !outer.pos) { surface.length = 0; return false; }
    hipsB.obj.updateMatrixWorld(false);
    _inv.copy(hipsB.obj.matrixWorld).invert();
    _up.set(0, 1, 0).transformDirection(hipsB.obj.matrixWorld);
    const p = outer.pos, cols = outer.cols, rows = outer.rows;
    let k = 0, prevY = null;
    for (let r = 0; r < rows; r++) {
      let rad = 0, y = 0, seen = 0;
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 3;
        _p.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(_inv);
        y += _p.y;
        rad = Math.max(rad, Math.hypot(_p.x, _p.z));
      }
      y /= cols;
      const cut = profileAt(y / S) * S;
      rad = Math.min(Math.max(rad, cut), cut * SWELL);
      // Everything below the strap's own tip is a band nothing will ever
      // touch, and a collider nothing touches is a test paid for four times a
      // frame for the life of the character.
      if (y < reach * S - 0.10 * S) break;
      const b = surface[k] || (surface[k] = { c: new THREE.Vector3(), r: 0, up: new THREE.Vector3(), h: 0 });
      b.c.set(0, y, 0).applyMatrix4(hipsB.obj.matrixWorld);
      b.r = rad;
      b.up.copy(_up);
      // Half the row spacing, plus a tenth of it so consecutive bands overlap
      // rather than leaving a seam of unconstrained height between them.
      b.h = prevY === null ? 0.055 * S : Math.abs(prevY - y) * 0.55;
      if (k > 0) surface[k - 1].h = b.h;
      prevY = y; k++;
    }
    surface.length = k;
    return k > 0;
  };

  for (const strap of parts) {
    strap.refreshColliders = () => {
      const out = strap.colliders;
      out.length = 0;
      if (stamp !== frame) { stamp = frame; resample(); }
      if (surface.length) {
        for (let i = 0; i < surface.length; i++) out.push(surface[i]);
      } else if (!hipsB.severed) {
        hipsB.obj.updateMatrixWorld(false);
        for (let i = 0; i < table.length; i++) {
          _v3.set(0, table[i][0] * S, 0).applyMatrix4(hipsB.obj.matrixWorld);
          out.push({ c: _v3.clone(), r: table[i][1] * S });
        }
      }
      return out;
    };
  }

  /** The pair, as one thing to step, carry, kick, hide and dispose. */
  return {
    parts,
    get initialised() { return parts.every((p) => p.initialised); },
    update(dt, wind) {
      frame++;                              // one resample of the robe per step
      for (const p of parts) if (p.enabled) p.update(dt, p.refreshColliders(), wind);
    },
    carry(quat, pivot) {
      for (const p of parts) if (p.enabled && p.initialised) p.carry(quat, pivot);
    },
    impulse(dir, strength, dt) { for (const p of parts) p.impulse(dir, strength, dt); },
    setVisible(v) { for (const p of parts) p.setVisible(v); },
    dispose() { for (const p of parts) p.dispose(); },
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  LEKKU — the head-tails, simulated                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A Twi'lek's lekku, as two closed tubes of cloth on the head.
 *
 * THE COMPLAINT. The species pass says so itself: "Lekku, montrals and
 * tentacles are RIGID geometry hung off the head object, not simulated:
 * Cloth.js belongs to another workstream". A rigid lek is welded to the skull,
 * so it tracks the head's yaw exactly and moves not one micron relative to it —
 * which is the same defect the rigid skirt had against the pelvis, and it reads
 * the same way: a prop, not a body part. Measured on a walking Twi'lek, a rigid
 * lek tip travels 0.000 mm in the head's frame over seven seconds while the
 * cape's hem beside it travels 217.
 *
 * THE SHAPE. A lek is a tapered tube, which is what `closed` already builds and
 * what `profile` already cuts: `profile(t)` is the radial multiplier down the
 * cloth, so a taper is one expression rather than a new class. Everything else
 * — the seam, the welded normals, the pinned ring, the fold occlusion — is the
 * skirt's machinery unchanged.
 *
 * THE COST, and it is the part that had to be designed rather than chosen. The
 * budget in tools/checks/_weave.mjs is per unit AREA: no garment may dice its
 * cloth finer than the cape does (cell ≥ the cape's cell), cost more particles
 * per m² (density), more links per particle, more solver passes, or more sphere
 * tests per m². A lek is small — 0.063 m² against the cape's 0.46 — so the
 * temptation is to dice it finely and "it is only a few particles". That is
 * exactly the reasoning the weave check exists to refuse. So:
 *
 *   cols 5, rows 6 — 30 particles a lek, 60 for the pair, 0.063 m² each,
 *   which is a cell of 41 cm² against the cape's 34: coarser, as required.
 *
 * FIVE COLLIDERS, not the cape's sixteen, for the same arithmetic: sphere tests
 * are particles × colliders ÷ area, and a small garment with a long collider
 * list blows that ratio even though the absolute number is tiny. Head, neck,
 * chest and one sphere per shoulder is what a lek can actually hit.
 *
 * @param opts.roots  [{ at:[x,y,z], r, len, taper }] in the head bone's frame,
 *                    mirrored on X. `at` is where the lek roots on the temple.
 * @param opts.rigid  the rigid meshes this replaces; hidden while it is live
 *                    and shown again by setVisible(false) at LOD range, exactly
 *                    as the skirt does with the rigid robe.
 */
export function attachLekku(scene, rig, opts = {}) {
  const S = opts.scale ?? 1;
  const headB = rig.get('head');
  if (!headB || !opts.roots || !opts.roots.length) return null;
  const cols = opts.cols ?? 5;
  const rows = opts.rows ?? 6;
  const parts = [];

  for (const root of opts.roots) {
    for (const sx of [-1, 1]) {
      const at = new THREE.Vector3(root.at[0] * sx, root.at[1], root.at[2]);
      const r0 = root.r, len = root.len, taper = root.taper ?? 0.24;
      const lek = new Cloak(scene, {
        closed: true,
        cols, rows,
        length: len * S,
        /*
         * THE TAPER. `profile` is a multiplier on the anchor ring, so a lek
         * that ends at `taper` of its root is one line — and it has to be a
         * curve rather than a straight ramp, because a lek is nearly parallel
         * for its first third and only closes over the last. Linear, it read as
         * a traffic cone.
         */
        profile: opts.profile ?? ((t) => 1 - (1 - taper) * t * t * (3 - 2 * t)),
        material: opts.material,
        color: opts.color ?? 0x6f8f6a,
        /*
         * NO SURPLUS AND NO PLEAT. A lek is skin over muscle, not cloth: it has
         * no gathered fabric in it and nothing to buckle. `fullness` 1 and
         * `pleat` 0 leave the ring at its cut circumference, which is what the
         * taper wants — and the note in reset() is the reason it matters, since
         * on a closed cloth a shortened across-rest does not fold, it shrinks.
         */
        fullness: 1, pleat: 0,
        /*
         * STIFF, and stiffer DOWN than across.
         *
         * This is the one place a lek is not a garment. Cloth's bend is nearly
         * nothing because fabric does not resist curving; a lek does — it is
         * held by muscle and it carries its own shape, so it should swing as a
         * heavy pendulum and arrive rather than ripple. bendDown 0.92 against
         * the cape's 0.55 is what stops the tip whipping, and `bendStretchOnly`
         * stays on because a lek that resisted being FOLDED as hard as being
         * pulled straight could not lie over a shoulder at all.
         */
        stiffness: opts.stiffness ?? 0.94,
        shear: opts.shear ?? 0.55,
        bend: opts.bend ?? 0.30,
        bendDown: opts.bendDown ?? 0.92,
        bendStretchOnly: true,
        // Heavier than cloth and much deafer to the air: a lek does not flutter.
        damping: opts.damping ?? 0.955,
        lift: opts.lift ?? 0.25,
        drift: opts.drift ?? 0.20,
        gravity: opts.gravity ?? -13,
        iterations: opts.iterations ?? 4,
        jitter: opts.jitter ?? 0,
        seed: opts.seed,
        foldAO: opts.foldAO ?? 0.30,
        anchorFn: (c, n, out) => {
          const th = (c / n) * Math.PI * 2;
          _m.copy(headB.obj.matrixWorld);
          out.set(at.x * S + Math.sin(th) * r0 * S * sx,
            at.y * S + Math.cos(th) * r0 * S * 0.42,
            at.z * S + Math.cos(th) * r0 * S);
          out.applyMatrix4(_m);
        },
      });
      lek._sharedMat = !!opts.material;
      lek.side = sx;
      parts.push(lek);
    }
  }

  /*
   * WHAT A LEK CAN HIT, and nothing else.
   *
   * The head it roots on, the neck beside it, the ribcage it lies against and
   * one sphere per shoulder — five, because the cost gate is particles ×
   * colliders ÷ area and a 0.063 m² garment carrying the cape's sixteen would
   * cost four times the cape's sphere tests per m² while looking cheap.
   */
  const bones = ['head', 'neck', 'chest'];
  const radii = [0.086, 0.062, 0.170];
  for (const lek of parts) {
    lek.refreshColliders = () => {
      const out = lek.colliders;
      out.length = 0;
      for (let i = 0; i < bones.length; i++) {
        const b = rig.get(bones[i]);
        if (!b || b.severed) continue;
        b.obj.updateMatrixWorld(false);
        _v3.set(0, b.length * (i === 2 ? 0.55 : 0.45), 0).applyMatrix4(b.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: radii[i] * S });
      }
      // the shoulder on this lek's own side, which is the surface it lies over
      const cb = rig.get(lek.side > 0 ? 'clavL' : 'clavR');
      if (cb && !cb.severed) {
        cb.obj.updateMatrixWorld(false);
        _v3.set(0, cb.length * 0.7, 0).applyMatrix4(cb.obj.matrixWorld);
        out.push({ c: _v3.clone(), r: 0.105 * S });
      }
      return out;
    };
  }

  const rigid = opts.rigid || [];
  /**
   * The pair, as one thing to update, hide and dispose — because the caller is
   * a seam in the menu rather than a line inside Player, and a seam should hand
   * back one object rather than an array the caller has to loop.
   */
  const group = {
    parts,
    get initialised() { return parts.every((l) => l.initialised); },
    update(dt, wind) {
      for (const l of parts) if (l.enabled) l.update(dt, l.refreshColliders(), wind);
    },
    carry(quat, pivot) {
      for (const l of parts) if (l.enabled && l.initialised) l.carry(quat, pivot);
    },
    setVisible(v) {
      for (const l of parts) l.setVisible(v);
      for (let i = 0; i < rigid.length; i++) rigid[i].visible = !v;
    },
    dispose() {
      for (let i = 0; i < rigid.length; i++) rigid[i].visible = true;
      for (const l of parts) l.dispose();
      parts.length = 0;
    },
  };
  group.setVisible(true);
  return group;
}
