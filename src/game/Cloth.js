/**
 * SABER — cloth.
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
    blurb: 'The longest cut the order allows, in something that hangs rather than flies. Four deep folds, and it is still moving a second after you have stopped.',
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

/**
 * Build a cloak that hangs from a rig's chest bone, with colliders tracking
 * the torso and legs so it drapes instead of clipping.
 */
export function attachCloak(scene, rig, opts = {}) {
  opts = withCut(opts, 'cloak');
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
  return cloak;
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
  skirt.setVisible = (v) => {
    skirt.mesh.visible = v;
    for (let i = 0; i < rigid.length; i++) rigid[i].visible = !v;
  };
  skirt.setVisible(true);
  const _dispose = skirt.dispose.bind(skirt);
  skirt.dispose = () => {
    for (let i = 0; i < rigid.length; i++) rigid[i].visible = true;
    // A cape still holding `outer` on a disposed skirt would collide against
    // the last frame this garment ever ran. Empty means "fall back to the
    // table", which is where the rigid layer is again.
    skirt.proxy.length = 0;
    _dispose();
  };
  return skirt;
}
