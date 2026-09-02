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
/* THE PLATE, from the body builders. `plateGeo` is the rounded slab every
 * helmet in Bodies.js is assembled from, and reading it from there is what
 * makes the marker's helmet the SAME helmet — the same brow, the same cheek
 * flare — rather than a memorial-shaped guess at one. Bodies.js is imported
 * and not edited; its own head shells are closures inside the builders, so
 * the helmets below are re-assembled here from the same parts at the same
 * numbers. */
import { plateGeo } from '../game/Bodies.js';

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
 * THE MARKER, AS A RIFLE AND THE MAN'S OWN HELMET.
 *
 * A rifle stuck muzzle-down with a helmet over the butt is the one silhouette
 * that means this and nothing else — it is not a rock, not a post, not a
 * crate. It was a half-sphere, and the player was right about it: "it should
 * be whatever specific helmet/head that npc had on a stick, right now it's a
 * generic blob on a stick I think it looks janky and fake". So the helmet is
 * now one of `HELMETS`, keyed off the record's archetype — a Phase I clone
 * bucket for the line, the same bucket with a rangefinder stalk for an ARC,
 * with the crest and the stalk for a commander, a B1's snout for a battle
 * droid, a B2's wedge for a super — each assembled from `plateGeo`, the part
 * Bodies.js builds the real ones from, at the real ones' numbers.
 *
 * ONE INSTANCED MESH PER HELMET KIND plus one for every rifle, allocated at
 * `GRAVE_MAX` each and drawn only while they have a count — three or four
 * draw calls for the whole field in an ordinary run, which is still nothing
 * beside a corpse at twenty-six. Different materials per kind, because the
 * value difference between dark metal and pale plastoid (or tan durasteel)
 * at 30 m is the whole of what makes the shape readable (§11's "value, not
 * hue, at scale").
 *
 * Nothing casts a shadow and nothing takes an ink outline. A memorial that
 * cost a shadow map per casualty would be a memorial the frame budget deletes
 * at the exact moment the run is going badly enough to have several.
 */
function rifleGeometry() {
  /* The rifle: a long thin box for the receiver and a shorter, thicker one for
   * the stock, merged by hand into one buffer rather than by a helper, because
   * `mergeGeometries` is a vendored import this file does not otherwise need. */
  const rifle = new THREE.BoxGeometry(0.07, RIFLE_LEN, 0.12);
  rifle.translate(0, RIFLE_LEN / 2, 0);
  return rifle;
}

/**
 * Concatenate positioned parts into one buffer. Each entry is
 * `[geometry, [x, y, z], [rx, ry, rz]?]`, the shape Bodies.js's own `assemble`
 * takes, so a helmet below reads like the builder it was copied from. Written
 * here rather than imported: `assemble` is not exported and
 * `BufferGeometryUtils` is a vendored module this file does not otherwise
 * need; this is thirty lines of position-and-normal bookkeeping.
 */
function assemble(parts) {
  const pos = [], nor = [];
  const m = new THREE.Matrix4(), e = new THREE.Euler(), n = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const [g0, at, rot] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    m.makeRotationFromEuler(e).setPosition(at[0], at[1], at[2]);
    n.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(n).normalize(); nor.push(v.x, v.y, v.z);
    }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** Where a helmet sits: over the butt of the rifle, its own bottom on it. */
const HELM_Y = RIFLE_LEN + 0.02;

/**
 * THE PHASE I BUCKET — `buildTrooper`'s `headShell`, the same seven plates at
 * the same numbers: cranium, faceplate, two cheeks flaring outboard and down,
 * chin, rear flare, dorsal fin. `s` is the builder's own scale argument.
 */
function cloneHelmet(s = 1, extra = []) {
  return assemble([
    [plateGeo(0.184 * s, 0.158 * s, 0.198 * s, 0.048 * s, 4), [0, HELM_Y + 0.136 * s, -0.030 * s]],
    [plateGeo(0.170 * s, 0.152 * s, 0.124 * s, 0.044 * s, 3), [0, HELM_Y + 0.096 * s, 0.044 * s], [-0.06, 0, 0]],
    [plateGeo(0.032 * s, 0.104 * s, 0.126 * s, 0.015 * s, 1), [0.085 * s, HELM_Y + 0.056 * s, 0.016 * s], [0, 0, 0.24]],
    [plateGeo(0.032 * s, 0.104 * s, 0.126 * s, 0.015 * s, 1), [-0.085 * s, HELM_Y + 0.056 * s, 0.016 * s], [0, 0, -0.24]],
    [plateGeo(0.126 * s, 0.058 * s, 0.106 * s, 0.024 * s, 1), [0, HELM_Y + 0.020 * s, 0.038 * s], [0.30, 0, 0]],
    [plateGeo(0.150 * s, 0.096 * s, 0.070 * s, 0.024 * s, 1), [0, HELM_Y + 0.056 * s, -0.126 * s], [0.30, 0, 0]],
    [plateGeo(0.026 * s, 0.058 * s, 0.190 * s, 0.010 * s, 1), [0, HELM_Y + 0.204 * s, -0.016 * s], [0.04, 0, 0]],
    ...extra,
  ]);
}

/** The ARC's rangefinder stalk — the one thing on the helmet that says ARC at range. */
const stalk = (s) => [
  [plateGeo(0.016 * s, 0.150 * s, 0.016 * s, 0.004 * s, 1), [0.095 * s, HELM_Y + 0.190 * s, -0.020 * s]],
  [plateGeo(0.030 * s, 0.022 * s, 0.070 * s, 0.006 * s, 1), [0.095 * s, HELM_Y + 0.270 * s, 0.010 * s]],
];
/** The commander's crest: a taller, longer fin. */
const crest = (s) => [
  [plateGeo(0.030 * s, 0.070 * s, 0.230 * s, 0.010 * s, 1), [0, HELM_Y + 0.236 * s, -0.010 * s], [0.04, 0, 0]],
];

/** `buildB1`'s `headShell`: the egg at the back, the snout, the ridge. */
function b1Head(s = 1.02) {
  const egg = new THREE.SphereGeometry(0.052 * s, 10, 8);
  egg.scale(0.92, 1.02, 1.22);
  return assemble([
    [egg, [0, HELM_Y + 0.114 * s, -0.030 * s]],
    [plateGeo(0.066 * s, 0.056 * s, 0.215 * s, 0.020 * s, 2), [0, HELM_Y + 0.108 * s, 0.092 * s], [0.10, 0, 0]],
    [plateGeo(0.058 * s, 0.046 * s, 0.070 * s, 0.014 * s, 1), [0, HELM_Y + 0.098 * s, 0.200 * s], [0.10, 0, 0]],
    [plateGeo(0.024 * s, 0.012 * s, 0.230 * s, 0.004 * s, 1), [0, HELM_Y + 0.140 * s, 0.070 * s], [0.10, 0, 0]],
  ]);
}

/** A B2's head is a wedge sunk into the chest; on a stick it is the wedge. */
function b2Head(s = 1.18) {
  return assemble([
    [plateGeo(0.200 * s, 0.090 * s, 0.220 * s, 0.030 * s, 3), [0, HELM_Y + 0.070 * s, 0]],
    [plateGeo(0.150 * s, 0.020 * s, 0.040 * s, 0.006 * s, 1), [0, HELM_Y + 0.080 * s, 0.112 * s]],
  ]);
}

/**
 * THE HELMETS, by kind. `build` makes the geometry once per attach; `colour`
 * is the value the plate reads at, and `of` says which archetypes wear it —
 * the roster's own type ids, so a Marksman and a heavy gunner share the
 * bucket their kits share.
 */
export const HELMETS = {
  clone:     { colour: 0x8f8a80, build: () => cloneHelmet(1) },
  arc:       { colour: 0x8f8a80, build: () => cloneHelmet(1.07, stalk(1.07)) },
  commander: { colour: 0x8f8a80, build: () => cloneHelmet(1, [...crest(1), ...stalk(1)]) },
  b1:        { colour: 0xb9a077, build: () => b1Head() },
  b2:        { colour: 0x9a8c72, build: () => b2Head() },
};
const HELMET_OF = {
  trooper: 'clone', marksman: 'clone', heavy: 'clone', jet: 'clone', sniper: 'clone',
  arc: 'arc', officer: 'commander', commander: 'commander',
  b1: 'b1', conscript: 'b1', droideka: 'b1', b2: 'b2',
};

/**
 * WHICH HELMET A RECORD WEARS. The archetype first; a look whose kit carries
 * a rangefinder stalk or a crest is an ARC or a commander whatever rung he
 * stood on; and an army with no row here wears its side's baseline — a
 * steel roster's unknown is a B1, a flesh roster's is a clone.
 */
export function helmetKindOf(rec) {
  const kit = rec?.look?.kit;
  if (kit && typeof kit === 'object') {
    if (kit.crest) return 'commander';
    if (kit.rangefinder === 'stalk') return 'arc';
  }
  return HELMET_OF[rec?.kind] || (rec?.army === 'steel' ? 'b1' : 'clone');
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
    /**
     * THE HOLES — the burial detail's, and the SCENE's rather than the run's.
     * `dig` opens one where a digger has finished, `fill` turns it into the
     * mound a marker stands on, `abandon` removes one a wave interrupted.
     * Ordinary meshes, a few at a time, never more than `BURY.maxHoles` per
     * order; they do not survive a change of ground because the ground they
     * were dug in does not.
     */
    this.holes = [];
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
    this.meshes = { rifle: mk(rifleGeometry(), 0x2b2a2e) };
    for (const kind in HELMETS) this.meshes[kind] = mk(HELMETS[kind].build(), HELMETS[kind].colour);
    this._rebuild();
    return this;
  }

  detach() {
    for (const h of this.holes) this._dropHole(h);
    this.holes.length = 0;
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

  /* ── the holes ──────────────────────────────────────────────────────── */

  /**
   * A HOLE, OPEN. A dark disc sunk a little into the ground with a ring of
   * spoil round it — the two things a fresh scrape is from ten metres. The
   * heightfield is not touched: its cell is 2.5–3.4 m and a grave is one, so
   * a crater would be five graves the ground could not tell apart.
   */
  dig(h) {
    if (!h || !this.scene) return null;
    this._dropHole(h);
    const g = new THREE.Group();
    const y = this.terrain?.height ? this.terrain.height(h.x, h.z) : (h.y ?? 0);
    h.y = y;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 0.06, 12),
      new THREE.MeshLambertMaterial({ color: 0x241c14 }));
    floor.position.y = 0.02;
    const spoil = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.22, 6, 14),
      new THREE.MeshLambertMaterial({ color: 0x4a3b2a }));
    spoil.rotation.x = Math.PI / 2;
    spoil.scale.y = 0.8;
    spoil.position.y = 0.06;
    for (const m of [floor, spoil]) { m.castShadow = false; m.receiveShadow = true; noInk(m.material); g.add(m); }
    g.position.set(h.x, y, h.z);
    g.name = 'grave-hole';
    this.scene.add(g);
    h.mesh = g;
    h.open = true;
    this.holes.push(h);
    return g;
  }

  /** …AND FILLED: the spoil goes back over him as a low mound, which is what the marker stands in. */
  fill(h) {
    if (!h) return null;
    this._dropHole(h);
    if (!this.scene) return null;
    const y = this.terrain?.height ? this.terrain.height(h.x, h.z) : (h.y ?? 0);
    h.y = y;
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x3e3123 }));
    mound.scale.set(0.75, 0.28, 1.05);
    mound.position.set(h.x, y - 0.02, h.z);
    mound.castShadow = false;
    mound.receiveShadow = true;
    noInk(mound.material);
    mound.name = 'grave-mound';
    this.scene.add(mound);
    h.mesh = mound;
    h.open = false;
    this.holes.push(h);
    return mound;
  }

  /** A hole nobody will fill — the wave came. */
  abandon(h) { this._dropHole(h); }

  _dropHole(h) {
    const m = h?.mesh;
    if (!m) return;
    m.removeFromParent();
    m.traverse?.((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
    if (m.isMesh) { m.geometry?.dispose?.(); m.material?.dispose?.(); }
    h.mesh = null;
    const i = this.holes.indexOf(h);
    if (i >= 0) this.holes.splice(i, 1);
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
      /* WHOSE HELMET, and WHO PUT HIM THERE. `kind` picks the marker's head
       * (see HELMETS); `dug` says the line buried him itself, which is what
       * `MORALE.PASSED_OWN_GRAVE` reads — a record with neither is a name
       * the run drew before the order existed and still means what it did. */
      kind: helmetKindOf(rec),
      dug: !!rec.dug,
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
    const counts = {};
    for (const kind in HELMETS) counts[kind] = 0;
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
      const kind = HELMETS[g.kind] ? g.kind : 'clone';
      M[kind].setMatrixAt(counts[kind]++, m);
    }
    M.rifle.count = shown.length;
    M.rifle.instanceMatrix.needsUpdate = true;
    for (const kind in HELMETS) {
      M[kind].count = counts[kind];
      M[kind].instanceMatrix.needsUpdate = true;
    }
  }

  /** How many markers of each helmet kind are drawn — for a check. */
  drawn() {
    const out = {};
    if (!this.meshes) return out;
    for (const kind in HELMETS) if (this.meshes[kind].count) out[kind] = this.meshes[kind].count;
    return out;
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
