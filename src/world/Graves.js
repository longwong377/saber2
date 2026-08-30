/**
 * BATTLEFRONT BORZ — THE GROUND KEEPS YOUR DEAD.
 *
 * PLAN.md §4.7's last item, and it is the cheapest thing in that section and
 * the one a player will remember. When a man with a name on the roll falls,
 * something stays on the exact ground he fell on: his rifle driven into the
 * dirt with his helmet on the butt of it. It is there for the rest of the run,
 * it is there when the line comes back over that ground in the next
 * engagement, and walking up to it says who he was.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY IT IS NOT A CORPSE, AND NOT ONE OF THE FALLEN EITHER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The tree already has two kinds of dead and this is a third, which is worth
 * stating because the temptation is to reach for one of the other two:
 *
 *   `Corpses.js` holds bodies that were ALIVE — a rig, a garment, a cloth
 *     solver, capsules that can be cut — at 26 draw calls each, and the budget
 *     is a few dozen for the whole field. They are recycled: a corpse is gone
 *     within a minute of the fight moving on, which is right for a body and
 *     exactly wrong for a memorial.
 *   `Fallen.js` is hundreds of instanced prone figures dressed onto a front by
 *     the level. Nobody was ever alive in one; the COUNT is the content. A
 *     named man cannot be one of those, because the whole point of him is that
 *     he is not a number.
 *
 * A grave is the third thing: one per NAME, permanent for the run, two draw
 * calls for all of them however many there are, and carrying a record rather
 * than a body. It holds no reference to the man — the same rule the `fell` log
 * follows, and for the same reason: the log outlives the body and a pointer
 * into a disposed rig would keep a whole skeleton alive for the length of a
 * sitting.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AND IT IS THE AFTER-ACTION REPORT, ON THE GROUND
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §4.9's report already knows who killed whom, from what bearing, at what
 * minute — `CommandDirector.onDeath` writes all three when it happens. This is
 * the same three facts, standing where it happened, findable by walking rather
 * than by reading a screen between engagements. A player who fights back over
 * ground he took an hour ago walks through his own casualty list.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { noInk } from '../toon/Ink.js';

/**
 * HOW MANY MARKERS THE FIELD DRAWS, and it is a cap on the DRAWING and not on
 * the record.
 *
 * A sitting that loses more than this many named men has lost the run twice
 * over — `MAX_STRENGTH` is 24 and a Raid fields ten at a time — so this is a
 * ceiling nobody reaches with a run in it. The instanced buffers are allocated
 * once at this size because an `InstancedMesh` cannot grow, and a field that
 * rebuilt itself on every death would be a rebuild per casualty.
 */
export const GRAVE_MAX = 64;

/** How close you have to be for it to say who it was, in metres. */
export const GRAVE_READ = 3.6;

/** How tall the marker stands. A rifle is 1.1 m and it is driven in a third. */
const RIFLE_LEN = 1.1;

/**
 * THE MARKER, AS TWO GEOMETRIES.
 *
 * A rifle stuck muzzle-down with a helmet over the butt is the one silhouette
 * that means this and nothing else — it is not a rock, not a post, not a
 * crate. Two instanced meshes rather than one merged geometry because the two
 * pieces want different materials: dark metal and pale plastoid, and the
 * value difference between them at 30 m is the whole of what makes the shape
 * readable (§11's "value, not hue, at scale").
 *
 * Neither casts a shadow and neither takes an ink outline. A memorial that
 * cost a shadow map per casualty would be a memorial the frame budget deletes
 * at the exact moment the run is going badly enough to have several.
 */
function graveGeometry() {
  /* The rifle: a long thin box for the receiver and a shorter, thicker one for
   * the stock, merged by hand into one buffer rather than by a helper, because
   * `mergeGeometries` is a vendored import this file does not otherwise need. */
  const rifle = new THREE.BoxGeometry(0.07, RIFLE_LEN, 0.12);
  rifle.translate(0, RIFLE_LEN / 2, 0);
  /* The helmet: a half-sphere, eight segments, sitting on the butt. */
  const helm = new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  helm.rotateX(Math.PI);
  helm.translate(0, RIFLE_LEN + 0.03, 0);
  return { rifle, helm };
}

export class GraveField {
  constructor() {
    /**
     * THE RECORD, WHICH OUTLIVES EVERY GROUND IT IS DRAWN ON.
     *
     * `{ x, y, z, name, rank, unit, at, killer }` — the same fields the `fell`
     * log carries, because they are the same event seen from the ground. The
     * list belongs to the RUN: `World.loadLevel` re-attaches the field to each
     * new scene and the markers are rebuilt from this, exactly as the crater
     * log is replayed onto each new heightfield.
     */
    this.entries = [];
    this.scene = null;
    this.meshes = null;
    /** How many have been read. A counter, so a check can price this. */
    this.read = 0;
  }

  get length() { return this.entries.length; }

  /**
   * PUT THE MARKERS ON THIS GROUND.
   *
   * Called once per level load with the scene that load built. Everything
   * already on the record is drawn again — a grave from engagement one is
   * standing on the same coordinates in engagement three, which is the whole
   * point of the record outliving the scene.
   */
  attach(scene, terrain = null) {
    this.detach();
    if (!scene) return this;
    this.scene = scene;
    this.terrain = terrain;
    const { rifle, helm } = graveGeometry();
    const mk = (geo, colour) => {
      const m = new THREE.InstancedMesh(geo,
        new THREE.MeshLambertMaterial({ color: colour }), GRAVE_MAX);
      m.count = 0;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.name = 'graves';
      /* `noInk` takes the MATERIAL, not the mesh — it stamps a flag the ink
       * prepass reads off `material.userData`. Handed a mesh it silently does
       * nothing, which is the shape of a bug that only shows up as an outline
       * nobody ordered. */
      noInk(m.material);
      scene.add(m);
      return m;
    };
    this.meshes = { rifle: mk(rifle, 0x2b2a2e), helm: mk(helm, 0x8f8a80) };
    this._rebuild();
    return this;
  }

  detach() {
    if (!this.meshes) return this;
    for (const m of Object.values(this.meshes)) {
      m.removeFromParent();
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    }
    this.meshes = null;
    this.scene = null;
    return this;
  }

  /**
   * A NAME OFF THE ROLL, AND THE GROUND HE WENT DOWN ON.
   *
   * Idempotent per record only in the sense that the caller is `onDeath`, which
   * `Roster.fall` already makes fire once per man — that guard is where it
   * belongs (a body can be reported dead twice) and this does not repeat it.
   */
  mark(rec) {
    if (!rec || !rec.name) return null;
    const g = {
      name: rec.name, rank: rec.rank || '', unit: rec.unit || '',
      at: rec.at ?? 0, killer: rec.killer || null,
      x: rec.x ?? 0, y: rec.y ?? 0, z: rec.z ?? 0,
      /* A LEAN AND A TURN, so a row of them does not read as a fence.
       * Deterministic in the name rather than random: a grave that stood at a
       * different angle after a reload would be a different grave. */
      lean: ((hash(rec.name) % 100) / 100 - 0.5) * 0.34,
      turn: (hash(rec.name + 'y') % 628) / 100,
      seen: false,
    };
    if (this.terrain?.height) g.y = this.terrain.height(g.x, g.z);
    this.entries.push(g);
    /* The oldest marker stops being DRAWN rather than the oldest man stopping
     * being dead: the record is the run's and the buffer is the scene's. */
    this._rebuild();
    return g;
  }

  _rebuild() {
    const M = this.meshes;
    if (!M) return;
    const shown = this.entries.slice(-GRAVE_MAX);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < shown.length; i++) {
      const g = shown[i];
      e.set(g.lean, g.turn, g.lean * 0.6);
      q.setFromEuler(e);
      /* SUNK BY A THIRD OF THE RIFLE. A marker standing exactly on the surface
       * reads as placed; one driven into it reads as driven into it, which is
       * the difference between a prop and a grave. */
      p.set(g.x, g.y - RIFLE_LEN * 0.33, g.z);
      m.compose(p, q, s);
      M.rifle.setMatrixAt(i, m);
      M.helm.setMatrixAt(i, m);
    }
    M.rifle.count = shown.length;
    M.helm.count = shown.length;
    M.rifle.instanceMatrix.needsUpdate = true;
    M.helm.instanceMatrix.needsUpdate = true;
  }

  /**
   * WALKING UP TO ONE READS IT — once, ever.
   *
   * `seen` is on the record and not on the frame, so a grave says who it was
   * the first time you stand over it and is quiet every time after, including
   * after a ground change. A marker that announced itself every time the line
   * walked past would be a memorial that becomes noise, which is the one way
   * this feature can fail.
   *
   * @returns the grave newly read this frame, or null.
   */
  update(dt, player) {
    if (!player || player.dead || !this.entries.length) return null;
    const px = player.position?.x ?? 0, pz = player.position?.z ?? 0;
    const r2 = GRAVE_READ * GRAVE_READ;
    let best = null, bestD = r2;
    for (const g of this.entries) {
      if (g.seen) continue;
      const dx = g.x - px, dz = g.z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return null;
    best.seen = true;
    this.read++;
    return best;
  }

  /** The line the marker says when you stand over it. */
  static epitaph(g) {
    const bits = [];
    if (g.unit) bits.push(g.unit);
    if (g.killer) bits.push(`by ${g.killer}`);
    const t = Math.max(0, g.at | 0);
    bits.push(`at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    return bits.join(' · ');
  }

  dispose() {
    this.detach();
    this.entries.length = 0;
  }
}

/** A small stable hash, so a marker's lean survives a reload. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000;
}
