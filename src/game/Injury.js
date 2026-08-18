/**
 * BATTLEFRONT BORZ — what a fight leaves on a body.
 *
 * The player asked to be able to SEE that they are hurt: blood and torn cloth,
 * accumulating as damage is taken, and switchable off. Three decisions settle
 * what that means here, and all three come out of src/toon/REFERENCE.md rather
 * than out of taste.
 *
 * 1. A MARK IS A FLAT SHAPE WITH AN INTERESTING SILHOUETTE. Rule 2. There is no
 *    decal projector in this renderer, no second UV set on a body, and — more
 *    to the point — a soft-edged splatter texture is a PBR leftover: a stain
 *    with a feathered edge is exactly what these frames never have. So a mark
 *    is a nine-sided polygon with jagged radii, laid on the surface it was
 *    raycast onto, in ONE flat colour with a hard edge. Nine triangles.
 *
 * 2. IT COSTS DRAW CALLS, AND THAT IS THE BUDGET. characters.mjs caps a body at
 *    76 meshes and the Jedi is 66 (up to 69 with a plaited beard and a padawan
 *    braid). Every mark on the same bone merges into ONE geometry, so the worst
 *    case is one extra mesh per wounded bone, and `maxBones` caps that at four.
 *    73 meshes, 146 draw calls with the shadow pass, on ONE figure — the player.
 *
 * 3. IT HAS TO SURVIVE BEING CUT UP. Everything is a direct child of a bone
 *    object, like the hair and everything a species wears, because Ragdoll's
 *    addBone() re-homes exactly the direct children of the bone it moves and
 *    makes them visible again. A wound inside a positioning Group is hidden by
 *    first person's `visible = false` and missed by the re-show — the defect
 *    the hair braid had.
 *
 * WHERE IT IS DRIVEN FROM. `Player.damage` is the single damage path in the
 * game and this workstream does not own Player.js, so `applyInjury` installs
 * itself on the same seam `applyFeelSettings` uses for camera shake and
 * hitstop: it wraps the method on the instance, reads the setting LIVE, and is
 * idempotent so it can be called on every world build and every options change.
 * Gating the funnel rather than the frame is the same argument as there — the
 * alternative is polling `hp` once a frame, which cannot tell a hit from a
 * regeneration and cannot know where it landed.
 */

import * as THREE from 'three';
import { surfacePoint } from './Bodies.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _mk = new THREE.Vector3();
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wd = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * The bones a wound can land on, and how big a mark is on each.
 *
 * Not every bone: a mark on a clavicle is inside the tabard and a mark on a
 * foot is under a boot. `r` is the mark's radius in metres at scale 1, and it
 * follows the limb — a 6 cm stain on a forearm is a bandage, and a 2 cm one on
 * a chest is a freckle.
 */
const SITES = [
  /**
   * THE RADII WERE TOO SMALL TO SEE, and that was the whole of player note
   * #42: "haven't been able to notice the player model looking injured or
   * bloody the more damaged they get."
   *
   * The system was not broken. tools/_hurt.mjs drives a real Player down its
   * health bar through the real damage funnel and counts what reaches the
   * screen: at 63 of 100 hp there were three marks and thirty-six triangles of
   * them, and they covered **0.00% of the body's projected silhouette** — nil
   * of 343 rays through a third-person camera at the game's own 3.05 m boom.
   *
   * The arithmetic says why, and it is not subtle. A chest mark at r = 0.055
   * is an 11 cm patch on a 1.78 m figure. At 3.05 m through a 60° lens the
   * frame is 3.5 m tall, so that mark is 3% of frame height and the arm marks
   * are 1.5% — a coin on a person, at a distance where the whole person is
   * half the screen. Three coins is not "looking injured", it is a texture
   * detail nobody will ever be at the right distance to read.
   *
   * So they are 2.4x, which puts a chest wound at 26 cm — a hand-sized tear
   * rather than a spot — and the limbs in proportion. That is the size a wound
   * has to be to read as one at the range you see your own body from, and it
   * is the range that decides it: this figure is only ever looked at from the
   * third-person boom or the character screen.
   */
  /* …AND THEY WENT UP AGAIN WHEN THE DOME CAME OFF, which is the same
   * measurement read the other way. The 2.4x above bought its visibility
   * partly from a shape that should never have existed: a raised cone
   * projects more area than the flat patch it is standing in for, so taking
   * the tent out of the mark took a third of the silhouette with it —
   * AND THEY CAME BACK DOWN when the shape was fixed, which is the same
   * measurement read a third way. Taking the dome off cost silhouette; adding
   * the runs that spread round the limb (see the placement pass) more than
   * paid it back, because a stain on the near side is worth more than a lump
   * on the far one. Measured through `tools/_hurt.mjs` at 53 hp: 2.01% with
   * the dome, 0.29% flat, 9.8% flat with the runs at 1.45x these radii — which
   * is a paint job. Back to roughly the 2.4x above and the reading is 4-6%:
   * plainly hurt, still a person. */
  { bone: 'chest', r: 0.128, w: 3 },
  { bone: 'spine', r: 0.116, w: 2 },
  { bone: 'hips', r: 0.105, w: 1 },
  { bone: 'armL', r: 0.07, w: 1 }, { bone: 'armR', r: 0.07, w: 1 },
  { bone: 'foreL', r: 0.060, w: 1 }, { bone: 'foreR', r: 0.060, w: 1 },
  { bone: 'thighL', r: 0.093, w: 1 }, { bone: 'thighR', r: 0.093, w: 1 },
  { bone: 'shinL', r: 0.075, w: 1 }, { bone: 'shinR', r: 0.075, w: 1 },
  { bone: 'head', r: 0.056, w: 1 },
];

/**
 * TWO TONES, NOT A GRADIENT.
 *
 * Rule 1. Blood on cloth is one dark crimson; the cloth torn open under it is
 * one near-black. Both are matte — rule 8, nothing is shiny — and both are
 * flat, so what separates a wound from the robe around it is the hard edge of
 * the polygon and nothing else. `blood` is deliberately dark rather than bright:
 * a saturated red on a cel figure reads as paint, and this palette's accents
 * are supposed to be the blade.
 */
export const INJURY_COLORS = { blood: 0x5e1418, tear: 0x140f0c, skin: 0x7a1c18 };

/** A deterministic stream, so the same character takes the same wounds twice. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * ONE MARK: a jagged polygon in the surface's own tangent plane.
 *
 * `n` rim points at radii jittered ±38%, which is what makes the outline
 * interesting rather than a disc — measured against the alternative, a regular
 * decagon reads as a sticker at any range because nothing in nature is round.
 * The fan centre is pushed 1.5 mm PROUD of the hit so it cannot z-fight the
 * body it is lying on, and the rim is pushed a further 1 mm out along the
 * surface normal at the same time as it is spread, which curves the patch onto
 * a limb instead of standing off it as a flat card.
 */
function markGeo(centre, normal, radius, rand, n = 9, wrap = null) {
  /**
   * THE TANGENTS ARE LOCAL, and that is not tidiness.
   *
   * They were the module scratch vectors `_v1` and `_v2`, which was fine while
   * this function only did arithmetic. It calls `wrap` now — a closure that
   * rays the body and uses those same two scratch vectors for the ray — so
   * from the second rim point on, `t1` and `t2` were the ray's leftovers and
   * every mark after the first vertex was built in a random plane. Measured:
   * 230 triangles of wound geometry covering 0.0% of the silhouette.
   */
  const t1 = new THREE.Vector3().copy(Math.abs(normal.y) > 0.9 ? _XAXIS : _UP)
    .cross(normal).normalize();
  const t2 = new THREE.Vector3().crossVectors(normal, t1).normalize();
  const pos = new Float32Array((n + 1) * 3), nrm = new Float32Array((n + 1) * 3);
  const idx = new Uint16Array(n * 3);
  pos[0] = centre.x; pos[1] = centre.y; pos[2] = centre.z;
  nrm[0] = normal.x; nrm[1] = normal.y; nrm[2] = normal.z;
  const phase = rand() * Math.PI * 2;
  const _rim = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    /**
     * A STAIN IS TALLER THAN IT IS WIDE, AND IT HAS RUN.
     *
     * The outline used to be `radius * (0.62 + 0.76 * rand())` in every
     * direction — a jittered disc, which is a BLOB, and note #31 is what a
     * blob on a body reads as: "it's more like you added a red blob or glob of
     * putty to the character model like it looks like you're diseased or have
     * growths or something."
     *
     * Two shape terms fix the read and both are physical. Blood runs DOWN, so
     * the patch is 1.45x as long vertically as across; and a run has a TAIL,
     * so the two or three rim points nearest straight-down reach further than
     * the jitter alone would take them. What comes out is a torn streak with
     * drips off the bottom of it rather than a coin.
     */
    const ca = Math.cos(a), sa = Math.sin(a);
    let r = radius * (0.58 + 0.72 * rand());
    // `t2` is the tangent nearest world down for any normal off the vertical,
    // so `sa` is how far down this rim point is. Only the downward half runs.
    const down = Math.max(0, -sa);
    r *= 1 + down * 0.45;
    if (down > 0.72 && rand() < 0.55) r *= 1.5 + rand() * 0.9;      // a drip
    _rim.copy(centre).addScaledVector(t1, ca * r * 1.02).addScaledVector(t2, sa * r * 1.34);
    /**
     * AND IT LIES ON THE BODY. This is the other half of the putty, and it was
     * the bigger half: the rim used to be pushed BACK along the normal by
     * `r * 0.22` while the centre stood 1.5 mm proud of the surface. On the
     * 26 cm chest mark the radii were widened to that is a 29 mm cone standing
     * off the chest — a dome, in flat crimson, with a hard edge round it. It
     * was not a stain that looked like a growth; it was a growth.
     *
     * `wrap` rays each rim point back onto the surface it belongs to, so the
     * patch curves round a forearm the way a stain does. Without one — a
     * caller that has no mesh to ray — every vertex takes the CENTRE's own
     * offset, which is flat and wrong on a tight curve but is never proud.
     */
    if (wrap) wrap(_rim, ca, sa, r);
    pos[(i + 1) * 3] = _rim.x; pos[(i + 1) * 3 + 1] = _rim.y; pos[(i + 1) * 3 + 2] = _rim.z;
    nrm[(i + 1) * 3] = normal.x; nrm[(i + 1) * 3 + 1] = normal.y; nrm[(i + 1) * 3 + 2] = normal.z;
    idx[i * 3] = 0; idx[i * 3 + 1] = i + 1; idx[i * 3 + 2] = ((i + 1) % n) + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Merge same-material geometries that are already in the bone's own frame. */
function mergeMarks(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const P = g.attributes.position, N = g.attributes.normal, I = g.index;
    pos.set(P.array, vo * 3); nrm.set(N.array, vo * 3);
    for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;
    vo += P.count; io += I.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class Injury {
  /**
   * @param rig       the Rig from buildJedi
   * @param opts.max      most marks a body may carry (default 6)
   * @param opts.maxBones most bones that may carry one, i.e. extra draw calls
   * @param opts.scale    the figure's scale
   */
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.scale = opts.scale ?? 1;
    /**
     * FOURTEEN, not six — and it is free.
     *
     * Marks on one bone MERGE into that bone's single mesh (see `_rebuild`),
     * so the draw-call budget is `maxBones`, not `max`. Six wounds was
     * therefore a taste number wearing a budget's clothes: it cost the same
     * as fourteen and gave a player who had lost two thirds of their health
     * three small marks. Fourteen marks at nine triangles is 126 triangles on
     * a 12 796-triangle figure — a hundredth of one body — and it is the
     * difference between "there is a mark on me" and "I am covered in it",
     * which is what note #42 asked for.
     *
     * `maxBones` IS the real budget, and it was under-spent. characters.mjs
     * caps a body at 76 meshes; the Jedi measures 64 today (`characters: no
     * archetype has quietly doubled in cost` prints it), and the header's
     * "66, up to 69 with a plaited beard and a padawan braid" is the worst
     * case. 69 + 7 = 76 exactly, so seven wounded bones is what the budget
     * actually affords and four was leaving three on the table.
     *
     * It is worth the three, because four bones is what made the marks
     * PLATEAU: measured over a twenty-hit fight, coverage of the body's
     * silhouette climbed to 2.0% and then stopped, because every further
     * wound landed on a bone that was already carrying marks. The eye reads
     * "hurt in four places" however many times you are hit after that.
     */
    this.max = opts.max ?? 14;
    this.maxBones = opts.maxBones ?? 7;
    this.rand = rng(opts.seed ?? 0x51ab27);
    /** Every wound taken, oldest first: { bone, dir, y, r, torn }. */
    this.wounds = [];
    /** bone name → the one mesh carrying its marks. */
    this.meshes = new Map();
    this.blood = new THREE.MeshStandardMaterial({
      color: INJURY_COLORS.blood, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.tear = new THREE.MeshStandardMaterial({
      color: INJURY_COLORS.tear, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.enabled = true;
  }

  /**
   * Which site a hit landed on.
   *
   * With a point, the bone whose MID-SHAFT is nearest it — mid-shaft rather
   * than origin because a bone's origin is its joint, so a bolt in the middle
   * of a thigh is equidistant from the hip and the knee and would land on
   * whichever bone happened to come first in the list. Without a point (a fall,
   * a burn, an explosion the solver never resolved to a limb) the site is drawn
   * from the weighted list, which is why a torso is `w: 3` and a forearm `w: 1`
   * — a body takes most of its damage where most of it is.
   */
  _siteFor(point) {
    const live = SITES.filter((s) => {
      const b = this.rig.get(s.bone);
      return b && !b.severed && b.primary;
    });
    if (!live.length) return null;
    if (point) {
      let best = null, bd = Infinity;
      for (const s of live) {
        const b = this.rig.get(s.bone);
        b.obj.updateMatrixWorld(false);
        _v1.set(0, b.length * 0.5, 0).applyMatrix4(b.obj.matrixWorld);
        const d = _v1.distanceToSquared(point);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    let total = 0;
    for (const s of live) total += s.w;
    let r = this.rand() * total;
    for (const s of live) { r -= s.w; if (r <= 0) return s; }
    return live[live.length - 1];
  }

  /** How hurt the body currently looks, 0 to 1. */
  get level() { return this.max ? Math.min(1, this.wounds.length / this.max) : 0; }

  /**
   * Take a hit.
   *
   * `point` is the world position the damage landed at and may be absent — a
   * fall, a burn, an explosion the solver never resolved to a limb. When it is
   * there the mark lands on the bone nearest it, which is the whole reason this
   * hangs off `Player.damage` and not off a health bar: a health bar knows how
   * much, and only the damage call knows where.
   *
   * `frac` is the share of the health pool the hit took, and it is what decides
   * whether the cloth is torn as well as bled on. A graze marks; a hit worth a
   * fifth of the body opens it.
   */
  hit(point, frac = 0.1) {
    if (!this.enabled) return null;
    const site = this._siteFor(point);
    if (!site) return null;
    const bone = this.rig.get(site.bone);
    if (!bone || bone.severed) return null;
    // the bearing the mark sits at, taken from the hit when there is one so a
    // bolt in the back does not open a hole in the chest
    let dir;
    if (point) {
      bone.obj.updateMatrixWorld(false);
      _m.copy(bone.obj.matrixWorld).invert();
      _v1.copy(point).applyMatrix4(_m);
      dir = new THREE.Vector3(_v1.x, 0, _v1.z);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      dir.normalize();
    } else {
      const a = this.rand() * Math.PI * 2;
      dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    }
    const y = bone.length * (0.18 + 0.64 * this.rand());
    /* `seed` AND `geo` ARE WHAT MAKE A WOUND CACHEABLE, and the seed is the
     * half that makes the cache legal. See `_rebuild`: the mark shapes used to
     * be drawn from one `rand` shared across every wound on the body, so a
     * wound's geometry depended on how many had been rayed before it and could
     * not be reused. Its own seed makes it a function of itself alone. */
    const w = { bone: site.bone, dir, y, r: site.r * this.scale * (0.7 + 0.6 * this.rand()),
      torn: frac > 0.16, seed: (this.rand() * 0xffffffff) >>> 0, geo: null };
    this.wounds.push(w);
    // Oldest first out. A body that accumulated marks forever would be solid
    // red by the third wave, and the cap is a draw-call budget as much as a
    // taste one — see the note at the top.
    while (this.wounds.length > this.max) this.wounds.shift();
    this._rebuild();
    return w;
  }

  /** Wipe every mark — a respawn, or the toggle going off. */
  clear() {
    this.wounds.length = 0;
    this._rebuild();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.clear();
  }

  /**
   * Rebuild the marks, one merged mesh per wounded bone.
   *
   * Everything is re-seated by raycasting the bone's OWN primary geometry in
   * the bone's own frame, which is the only way a mark lands on the surface a
   * player can see: the torso lathes are revolved circular and then squashed on
   * Z by the mesh scale, so "the surface is at chestR" is wrong by up to four
   * centimetres depending on the bearing. Same argument as onLimb() in
   * Bodies.js, and the same failure if it is skipped — a patch floating off the
   * flank with its corners buried.
   */
  _rebuild() {
    for (const m of this.meshes.values()) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes.clear();
    if (!this.wounds.length) return;
    // youngest wounds first, so the cap on bones keeps the freshest damage
    const byBone = new Map();
    for (let i = this.wounds.length - 1; i >= 0; i--) {
      const w = this.wounds[i];
      if (!byBone.has(w.bone) && byBone.size >= this.maxBones) continue;
      if (!byBone.has(w.bone)) byBone.set(w.bone, []);
      byBone.get(w.bone).push(w);
    }
    for (const [name, list] of byBone) {
      const bone = this.rig.get(name);
      const prim = bone && bone.primary;
      if (!prim || !prim.geometry) continue;
      /**
       * THE OUTERMOST SURFACE AT THAT BEARING, not the limb underneath it.
       *
       * `bone.primary` is the body — the torso lathe, the sleeve, the shin —
       * and on this figure most of it is under something: the chest carries a
       * tabard front and back, the hips carry an obi and two skirts, the shin
       * carries a boot shaft. A mark raycast onto the primary alone is INSIDE
       * the garment over it, which is a wound the player cannot see. Measured
       * on the shipped robe, four of six sites are covered.
       *
       * So every mesh the bone carries is rayed and the FURTHEST hit wins,
       * which puts the mark on whatever the eye actually meets — cloth if there
       * is cloth there, skin if there is not. `boneChild` meshes are skipped:
       * those are other bones' geometry parented through, and a mark belongs to
       * the bone it was placed on.
       */
      const skins = [prim];
      for (const o of bone.obj.children) {
        if (o.isMesh && o !== prim && !o.userData.boneChild && !o.userData.injury && o.geometry) skins.push(o);
      }
      const blood = [], tears = [];
      for (const w of list) {
        /**
         * ── A WOUND IS RAYED ONCE, NOT ONCE PER LATER WOUND ────────────────
         *
         * `_rebuild` re-rayed EVERY mark on the body every time one was added,
         * and `hit()` calls it. A single wound is about a hundred rays and
         * `surfacePoint` is a brute-force Möller–Trumbore over the bone's whole
         * triangle count — a chest is 832 and a head 2 532 — so the cost grew
         * with the square of how hurt the player already was.
         *
         * Measured, ray-triangle tests: the 1st wound 86 088, the 7th 638 064,
         * the 14th 1 293 852 — twenty times the triangle count of the entire
         * cast, paid on the frame the player is hit. As a timing, seven repeats
         * each and quoted only because the two sets do not overlap: 66.6–123 ms
         * shipped against 4.0–4.7 ms cached, a four-to-seven frame stall that
         * got worse the closer to death you were.
         *
         * KEYED ON THE GEOMETRY IT WAS RAYED ONTO, by identity. A mark lives in
         * bone-local space and cannot move — except that `Ragdoll` REPLACES
         * `bone.primary.geometry` when a limb is cut short, and a mark seated
         * on the old lathe would then be floating off the stump. Identity is
         * exact for that, and it degrades the safe way: a geometry this cache
         * does not recognise is rebuilt.
         *
         * Nothing else needs invalidating — `clear()` and the `wounds.shift()`
         * cap drop the cache with the wound that owns it.
         */
        if (w.geo && w.geo.on === prim.geometry) {
          blood.push(...w.geo.blood);
          if (w.geo.tear) tears.push(w.geo.tear);
          continue;
        }
        const rand = rng(w.seed ?? 0x9e3779b1);
        const wb = [];
        const y = Math.min(Math.max(w.y, 0.01), bone.length - 0.01);
        let p = null, best = -Infinity;
        for (const m of skins) {
          // The ray is pushed through the inverse of the mesh scale and the hit
          // pushed back out through it, exactly as onLimb does.
          const sx = m.scale.x || 1, sy = m.scale.y || 1, sz = m.scale.z || 1;
          const d = _v1.set(w.dir.x / sx, 0, w.dir.z / sz).normalize();
          const o = _v2.set(0, (y - m.position.y) / sy, 0);
          const q = surfacePoint(m.geometry, d, o, new THREE.Vector3(), true);
          if (!q) continue;
          q.set(q.x * sx, q.y * sy + m.position.y, q.z * sz);
          const reach = q.x * w.dir.x + q.z * w.dir.z;
          // and it has to be at the height the wound is, not the top of a
          // panel that happens to reach further out somewhere else
          if (Math.abs(q.y - y) > 0.10 * this.scale) continue;
          if (reach > best) { best = reach; p = q; }
        }
        if (!p) continue;
        const n = new THREE.Vector3(w.dir.x, 0, w.dir.z).normalize();
        p.addScaledVector(n, 0.0015 * this.scale);
        /**
         * THE WRAP. Every rim point is put back on the surface it belongs to,
         * by the same ray that found the wound's own centre — see `markGeo`.
         *
         * The ray is cast at the rim point's OWN bearing and OWN height, so a
         * stain across the outside of a forearm follows the forearm instead of
         * standing off it as a card. Bearing and height are all a lathe needs:
         * everything a bone carries is a body of revolution about its Y.
         */
        const rayAt = (bear, atY) => {
          const dir = _wd.set(Math.sin(bear), 0, Math.cos(bear));
          let hit = null, far = -Infinity;
          for (const m of skins) {
            const sx = m.scale.x || 1, sy = m.scale.y || 1, sz = m.scale.z || 1;
            const d = _wa.set(dir.x / sx, 0, dir.z / sz).normalize();
            const o = _wb.set(0, (atY - m.position.y) / sy, 0);
            const q = surfacePoint(m.geometry, d, o, _mk, true);
            if (!q) continue;
            const px = q.x * sx, py = q.y * sy + m.position.y, pz = q.z * sz;
            if (Math.abs(py - atY) > 0.14 * this.scale) continue;
            const reach = px * dir.x + pz * dir.z;
            if (reach > far) { far = reach; hit = [px, pz]; }
          }
          return hit;
        };
        const wrapTo = (proud, centre = p) => (out) => {
          const bear = Math.atan2(out.x, out.z);
          let hit = rayAt(bear, out.y);
          /**
           * AND IF THE RIM'S OWN HEIGHT MISSES, IT WALKS BACK TOWARD THE
           * WOUND'S UNTIL IT DOES NOT.
           *
           * A rim point past the top of a plate or off the end of a limb gets
           * no answer at that height. The first draft fell back to the
           * CENTRE's radius at the rim's bearing, which is exact on a cylinder
           * and 5 cm out on a chest — a torso section is an ellipse, not a
           * circle, so a radius borrowed from one bearing is wrong at another.
           * `grooming` measured that as a vertex 52 mm off the body.
           *
           * Walking the height home is the honest answer: it finds the nearest
           * height at which this bearing HAS a surface, which is the edge of
           * whatever the rim ran off, and puts the vertex there. A stain that
           * reaches past the hem of a tabard therefore stops at the hem.
           */
          for (let k = 1; k <= 4 && !hit; k++) {
            hit = rayAt(bear, out.y + (centre.y - out.y) * (k / 4));
          }
          if (!hit) return;
          const dx = Math.sin(bear), dz = Math.cos(bear);
          out.set(hit[0] + dx * proud, out.y, hit[1] + dz * proud);
        };
        wb.push(markGeo(p, n, w.r, rand, 9, wrapTo(0.0015 * this.scale)));
        /**
         * AND IT SPREADS ROUND THE LIMB, which is both what blood does and
         * what makes a wound visible from anywhere but the angle it was
         * inflicted from.
         *
         * A hit knows the bearing it came from, so a single stain is on the
         * side the attacker was standing. Measured through `tools/_hurt.mjs`,
         * which looks at the player from the third-person boom BEHIND them:
         * one stain per wound covered 0.6% of the silhouette, because most of
         * the marks were on the far side of the body from the camera.
         *
         * The old answer to that was accidental and is the thing note #31 is
         * about — a 29 mm dome standing off the chest is visible from behind
         * because it breaks the outline. This is the real one: two smaller
         * runs at 40-80 degrees of bearing either side, which is where blood
         * off a wound in the side of a chest actually ends up, and which puts
         * something on the visible half whichever half that is.
         *
         * They are laid into the SAME merged geometry, so the cost is
         * triangles and not draw calls — the budget note at the top of this
         * file is about meshes per bone and this does not add one.
         */
        for (let k = 0; k < 2; k++) {
          const off = (0.70 + rand() * 0.70) * (k ? 1 : -1);
          const bear = Math.atan2(n.x, n.z) + off;
          const sn = new THREE.Vector3(Math.sin(bear), 0, Math.cos(bear));
          /* AT ITS OWN BEARING, which is the whole point: the first draft put
           * the satellite at the parent's x/z with a different normal, so it
           * was a second stain in the same place. The bone is a body of
           * revolution, so a bearing plus the parent's own radius is a point
           * beside it round the limb, and `wrapTo` then puts it on the skin. */
          const R = Math.hypot(p.x, p.z) || 0.01;
          const sp = new THREE.Vector3(sn.x * R, p.y - w.r * (0.15 + rand() * 0.5), sn.z * R);
          wrapTo(0.0015 * this.scale)(sp);
          wb.push(markGeo(sp, sn, w.r * (0.34 + rand() * 0.26), rand, 7,
            wrapTo(0.0015 * this.scale, sp)));
        }
        if (w.torn) {
          // The tear is a SMALLER shape inside the stain, so the wound reads as
          // an opening with blood around it rather than as two patches. One
          // shape inside another with a hard edge between them is the whole
          // grammar of this look.
          const q = p.clone().addScaledVector(n, 0.0010 * this.scale);
          w.geo = { on: prim.geometry, blood: wb,
            tear: markGeo(q, n, w.r * 0.46, rand, 7, wrapTo(0.0026 * this.scale)) };
          tears.push(w.geo.tear);
        }
        // …and an untorn wound caches too, with nothing in the tear slot.
        if (!w.geo || w.geo.on !== prim.geometry) w.geo = { on: prim.geometry, blood: wb, tear: null };
        blood.push(...wb);
      }
      if (!blood.length) continue;
      const mesh = new THREE.Mesh(mergeMarks(blood), this.blood);
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.injury = true;
      bone.obj.add(mesh);
      this.meshes.set(name, mesh);
      if (tears.length) {
        const tm = new THREE.Mesh(mergeMarks(tears), this.tear);
        tm.castShadow = false; tm.receiveShadow = true;
        tm.userData.injury = true;
        // Merged into the blood mesh's own draw call is not possible — a second
        // material is a second call by definition — so the tears go on the SAME
        // geometry family and are counted in the budget at the top.
        bone.obj.add(tm);
        this.meshes.set(name + ':tear', tm);
      }
    }
  }

  dispose() {
    for (const m of this.meshes.values()) { m.removeFromParent(); m.geometry.dispose(); }
    this.meshes.clear();
    this.blood.dispose(); this.tear.dispose();
  }
}

/**
 * INSTALL THE DAMAGE GATE, live, on every player in a world.
 *
 * The same shape as applyFeelSettings' shake and hitstop gates and for the same
 * reason: `Player.damage` is the one funnel every hit in the game goes through,
 * it is called from a dozen places, and this workstream may not add a line to
 * any of them. Wrapping the funnel means a hit from a bolt, a blade, a fall and
 * an explosion all mark the body without any of them knowing this exists.
 *
 * Reads the setting LIVE off `world._injurySettings` rather than capturing it,
 * so unticking the box on the pause card wipes the marks on the very next
 * frame instead of at the next deploy — and the wipe is immediate rather than
 * "no new marks from now on", which is what a player unticking it means.
 *
 * Idempotent, and returns true once the gate is in place.
 */
export function applyInjury(world, s = {}) {
  if (!world) return false;
  world._injurySettings = s;
  let armed = false;
  for (const p of world.players || []) {
    if (!p || typeof p.damage !== 'function' || !p.rig) continue;
    if (!p.injury) p.injury = new Injury(p.rig, { seed: 0x51ab27 });
    // `s.injury !== false` — the setting is ON unless the player turned it off,
    // because a body that shows what has been done to it is the feature and the
    // box exists to switch it off, not on.
    p.injury.setEnabled(s.injury !== false);
    if (!p._injuryGated) {
      const damage = p.damage.bind(p);
      /* VARIADIC, because this wrapper only wants to watch. Naming the four
       * arguments it happened to know about is how it came to swallow the fifth
       * — `preResisted`, which `Player.applyKnockback` sets to say the pool has
       * already paid for this blow — and every enemy shove at a player with
       * injuries armed (which is every player) was billed to the Force bar
       * twice. See the same note in `Waves.js boonGuard`. */
      p.damage = (amount, point, ...rest) => {
        const before = p.hp;
        const died = damage(amount, point, ...rest);
        const took = before - p.hp;
        if (took > 0 && p.injury && p.injury.enabled) {
          p.injury.hit(point, took / Math.max(1, p.maxHp));
        }
        return died;
      };
      p._injuryGated = true;
      // A resurrection has to come back clean. `heal` is the only route back up
      // that is not a respawn, and a body that is whole again with six holes in
      // it is the same lie the other way round.
      const heal = p.heal.bind(p);
      p.heal = (v) => { heal(v); if (p.hp >= p.maxHp && p.injury) p.injury.clear(); };
    }
    armed = true;
  }
  return armed;
}
