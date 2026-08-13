/**
 * SABER — ragdolls and dismemberment.
 *
 * Cutting is geometric. A limb is a tube of known length, so a blade crossing
 * it at 62 % rebuilds the stub at 0.62·L, builds a new tube for the remaining
 * 0.38·L, caps both faces with a molten disc that cools from white through
 * orange to black, and hands the severed piece — along with everything hanging
 * off it — to the physics solver with the blade's momentum already in it.
 *
 * Nothing about that is authored. Cut a droid's forearm halfway and you get
 * half a forearm, because that is what half a forearm is.
 *
 * ── on Rapier ─────────────────────────────────────────────────────────────
 *
 * Every bone is a Rapier rigid body with a CAPSULE collider the length and
 * radius of the bone it stands for, and every articulation is a RagdollJoint —
 * Rapier's spherical joint for the socket, with the cone, twist and rest-pose
 * motor of JOINT_LIMITS on top. Cutting rebuilds a collider rather than
 * rebuilding a sphere cluster: `Body.setShape(capsule(...))` swaps a limb for
 * a shorter limb without disturbing the body that is already falling.
 *
 * The point of the move is that there is now ONE world. A corpse knocks a
 * crate over, a hurled crate rolls a corpse, and a severed forearm piles up
 * with the rubble, because they are all in the same broadphase.
 */

import * as THREE from 'three';
import { Body, RagdollJoint, LAYER, capsuleSpheres, capsule, selfGroup } from '../physics/RapierWorld.js';
import { limbGeo } from './Bodies.js';
import { clamp, lerp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(31337);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

/* ── cauterised cut faces ────────────────────────────────────────────── */

const CAP_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN;
  void main(){ vUv = uv; vN = normalize(normalMatrix*normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const CAP_FRAG = /* glsl */`
  uniform float uHeat; uniform vec3 uCold; uniform vec3 uBladeColor;
  varying vec2 vUv; varying vec3 vN;
  void main(){
    float r = length(vUv - 0.5) * 2.0;
    float rim = smoothstep(1.02, 0.55, r);
    // the rim stays hot longest — that's how cut metal actually cools
    float h = clamp(uHeat * (0.45 + rim * 0.9), 0.0, 1.6);
    vec3 hot = mix(vec3(1.6,0.32,0.03), vec3(2.6,2.3,1.9), clamp(h-0.45,0.0,1.0));
    vec3 c = mix(uCold, hot, clamp(h*1.5,0.0,1.0));
    c += uBladeColor * pow(clamp(h,0.0,1.0), 3.0) * 0.5;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const activeCaps = [];

export function makeCapMaterial(bladeColor) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uHeat: { value: 1.35 },
      uCold: { value: new THREE.Color(0x0b0a09) },
      uBladeColor: { value: new THREE.Color(bladeColor || 0x57c9ff) },
    },
    vertexShader: CAP_VERT, fragmentShader: CAP_FRAG,
    toneMapped: false, side: THREE.DoubleSide,
  });
  activeCaps.push(m);
  return m;
}

export function updateCauterisation(dt) {
  for (let i = activeCaps.length - 1; i >= 0; i--) {
    const m = activeCaps[i];
    const u = m.uniforms.uHeat;
    u.value -= dt * 0.36;
    if (u.value <= 0) { u.value = 0; activeCaps.splice(i, 1); }
  }
}

function capMesh(radius, bladeColor) {
  const g = new THREE.CircleGeometry(radius, 14);
  const m = new THREE.Mesh(g, makeCapMaterial(bladeColor));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/**
 * The collider for a limb of length `len` and radius `r`, centred on the bone's
 * midpoint with +Y along it. Rapier's capsule is a segment with hemispherical
 * caps, so the segment is the bone minus one radius at each end and the whole
 * thing is exactly `len` long — which is what makes a cut limb the length it
 * looks, and what makes two of them stack the way two tubes stack.
 */
function limbCapsule(len, r) {
  return capsule(Math.max(0.004, len * 0.5 - r), r);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Actor — a rig that can be cut and can collapse                        */
/* ══════════════════════════════════════════════════════════════════════ */

let _pieceId = 1;
let _actorSeq = 0;

export class Actor {
  /**
   * @param rig       Rig instance (bones already dressed with meshes)
   * @param opts.mass total mass
   */
  constructor(scene, physics, rig, opts = {}) {
    this.scene = scene;
    this.physics = physics;
    this.rig = rig;
    this.mass = opts.mass ?? 74;
    this.layer = opts.layer ?? LAYER.ENEMY;
    this.bladeColor = opts.bladeColor ?? 0x57c9ff;
    this.ragdolled = false;
    this.bodies = new Map();      // bone name → Body
    this.holders = new Map();     // bone name → holder Group
    this.pieces = [];             // detached debris groups
    this.onSever = opts.onSever || null;
    this.severedCount = 0;
    this.rootScale = opts.scale ?? 1;
    /** So this corpse's own bones ignore each other — see SELF_GROUPS. */
    this.selfGroup = selfGroup(_actorSeq++);
    scene.add(rig.root);
  }

  /* ── cutting ───────────────────────────────────────────────────────── */

  /**
   * Cut a bone at fraction `t` of its remaining length.
   * @returns {boolean} whether anything was severed
   */
  cut(boneName, t, impulse, cutPoint, opts = {}) {
    const bone = this.rig.get(boneName);
    if (!bone || bone.severed) return false;
    t = clamp(t, 0.06, 0.94);
    // A corpse's bones are already loose bodies with colliders of their own, so
    // cutting one is a shorter collider and a broken joint — not a new piece.
    if (this.ragdolled) {
      const ok = this.cutRagdoll(boneName, impulse, t);
      if (ok && this.onSever) this.onSever(boneName, cutPoint, null);
      return ok;
    }

    const fullLen = bone.length * bone.cutT;
    const keepLen = fullLen * t;
    const dropLen = fullLen - keepLen;

    // rebuild the stub
    const limbInfo = bone.primary?.userData?.limb;
    const r0 = limbInfo ? limbInfo.r0 : bone.radius;
    const r1 = limbInfo ? limbInfo.r1 : bone.radius * 0.85;
    const rCut = lerp(r0, r1, t * bone.cutT);

    if (limbInfo && bone.primary) {
      bone.primary.geometry.dispose();
      bone.primary.geometry = limbGeo(keepLen, r0, rCut, limbInfo.seg, true);
    }
    // any decoration on this bone beyond the cut goes with the piece
    const detachedDecor = [];
    for (let i = bone.obj.children.length - 1; i >= 0; i--) {
      const c = bone.obj.children[i];
      if (c === bone.primary) continue;
      if (c.userData.boneChild) continue;                 // child bone objects
      if (c.isObject3D && c.position.y > keepLen + 0.02 && !c.userData.noDetach) {
        detachedDecor.push(c);
      }
    }

    // molten face on the stub
    const stubCap = capMesh(rCut * 1.02, this.bladeColor);
    stubCap.position.y = keepLen;
    stubCap.userData.noDetach = true;
    bone.obj.add(stubCap);

    // gather the subtree that comes away
    const subtree = [];
    const walk = (b) => { for (const c of b.children) { if (!c.severed) { subtree.push(c); walk(c); } } };
    walk(bone);

    // build the detached piece
    const piece = new DetachedPiece(this.scene, this.physics, this.bladeColor);
    piece.addStub(bone, keepLen, dropLen, rCut, r1, limbInfo);
    for (const d of detachedDecor) piece.adoptDecor(d, bone, keepLen);
    for (const c of subtree) piece.addBone(c);
    piece.finalise(impulse, cutPoint, opts.spin ?? 1);
    this.pieces.push(piece);

    bone.cutT *= t;
    for (const c of subtree) { c.severed = true; c.obj.visible = false; }
    this.severedCount++;

    if (this.onSever) this.onSever(boneName, cutPoint, piece);
    return true;
  }

  /** Is this bone (or an ancestor) already gone? */
  isSevered(name) {
    let b = this.rig.get(name);
    while (b) { if (b.severed) return true; b = b.parent; }
    return false;
  }

  /* ── collapse ──────────────────────────────────────────────────────── */

  /** Convert the whole rig into a live articulated ragdoll. */
  goRagdoll(velocity, angular) {
    if (this.ragdolled) return;
    this.ragdolled = true;
    this.rig.updateMatrices();

    /**
     * A bone weighs its share of the whole body, by limb volume.
     *
     * This was `clamp(len·r²·260, 0.6, 22)` per bone, which clamped nearly
     * every bone of a humanoid to the 0.6 kg floor and made a 52 kg droid weigh
     * eleven. That did not matter while ragdolls were on a solver of their own
     * and could not touch anything; now that a corpse is in the same world as
     * the crates, it does — an eleven kilo corpse landing on a fourteen kilo
     * crate moved it 3cm, and a fifty-two kilo one tips it over.
     */
    let volume = 0;
    for (const bone of this.rig.list) {
      if (bone.severed || bone.parts.length === 0) continue;
      const len = Math.max(0.04, bone.length * bone.cutT);
      const r = Math.max(0.028, bone.radius * 0.92);
      volume += len * r * r;
    }
    const perVolume = this._perVolume = volume > 1e-9 ? this.mass / volume : 260;

    const joints = [];
    for (const bone of this.rig.list) {
      if (bone.severed || bone.parts.length === 0) continue;
      const len = Math.max(0.04, bone.length * bone.cutT);
      const r = Math.max(0.028, bone.radius * 0.92);

      bone.obj.updateMatrixWorld(true);
      _m1.copy(bone.obj.matrixWorld);
      _v1.setFromMatrixPosition(_m1);
      _q1.setFromRotationMatrix(_m1);
      const mid = _v2.copy(_v1).add(_v3.set(0, len * 0.5, 0).applyQuaternion(_q1));

      const shareOfMass = clamp(len * r * r * perVolume, 0.35, this.mass * 0.4);
      const body = new Body({
        position: mid, quaternion: _q1,
        shape: limbCapsule(len, r),
        spheres: capsuleSpheres(Math.max(0.001, len * 0.5 - r * 0.6), r, 'y', len > r * 3 ? 3 : 2),
        mass: shareOfMass,
        friction: 0.72, restitution: 0.02,
        linearDamping: 0.08, angularDamping: 0.18,
        solverIterations: 4, inertiaScale: 3,
        layer: LAYER.RAGDOLL,
        mask: LAYER.WORLD | LAYER.RAGDOLL | LAYER.DEBRIS | LAYER.PROP | LAYER.PLAYER,
        selfGroup: this.selfGroup,
      });
      if (velocity) body.velocity.copy(velocity);
      if (angular) body.angularVelocity.copy(angular);
      body.userData.actor = this;
      body.userData.bone = bone.name;
      this.physics.add(body);
      this.bodies.set(bone.name, body);

      // re-home the visuals onto a holder driven by the body
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.y = -len * 0.5;
      holder.add(inner);
      holder.position.copy(mid);
      holder.quaternion.copy(_q1);
      for (let i = bone.obj.children.length - 1; i >= 0; i--) {
        const c = bone.obj.children[i];
        if (c.userData.boneChild) continue;
        inner.add(c);
        c.visible = true;                // see addBone: a corpse is never headless
      }
      this.scene.add(holder);
      this.holders.set(bone.name, holder);
      bone.holder = holder;
    }

    // wire the joints
    for (const bone of this.rig.list) {
      if (!bone.parent) continue;
      const a = this.bodies.get(bone.parent.name);
      const b = this.bodies.get(bone.name);
      if (!a || !b) continue;
      const parentLen = bone.parent.length * bone.parent.cutT;
      const anchorA = _v1.copy(bone.offset).setY(bone.offset.y - parentLen * 0.5);
      const len = bone.length * bone.cutT;
      const anchorB = _v2.set(0, -len * 0.5, 0);
      const limits = JOINT_LIMITS[stripSide(bone.name)] || { cone: 1.1, twist: 0.7 };
      const j = new RagdollJoint(a, b, anchorA, anchorB, {
        coneAngle: limits.cone,
        twistLimit: limits.twist,
        stiffness: limits.stiff ?? 0,
        damping: 0.3,
        restQuat: bone.restQuat.clone(),
      });
      this.physics.addJoint(j);
      joints.push(j);
    }
    this.joints = joints;
    this.rig.root.visible = false;
    return this;
  }

  /** Drive the visual holders from the physics bodies. */
  syncRagdoll() {
    if (!this.ragdolled) return;
    for (const [name, body] of this.bodies) {
      const h = this.holders.get(name);
      if (!h) continue;
      h.position.copy(body.position);
      h.quaternion.copy(body.quaternion);
    }
  }

  /**
   * Cut a ragdolled body apart — severing a joint on an already-dead body.
   *
   * With a fraction `t`, the bone is shortened as well as detached: its capsule
   * is rebuilt at `t` of its length, the body is re-seated so the stub still
   * starts where the joint was, and the visual holder is re-hung to match. That
   * is the whole of "rebuild the collider at runtime" on Rapier — one
   * `setShape`, with the body's velocity, joints and island left alone.
   */
  cutRagdoll(boneName, impulse, t = 0) {
    const bone = this.rig.get(boneName);
    if (!bone) return false;
    const body = this.bodies.get(boneName);
    let broke = false;
    for (const j of [...this.physics.joints]) {
      if (j.b === body) { this.physics.removeJoint(j); broke = true; }
    }
    if (body && t > 0 && t < 1) {
      const len = Math.max(0.04, bone.length * bone.cutT);
      const keep = len * t;
      const r = Math.max(0.028, bone.radius * 0.92);
      // the base of the bone stays put; the centre moves up to the new midpoint
      _v1.set(0, (keep - len) * 0.5, 0).applyQuaternion(body.quaternion);
      body.setTransform(_v2.copy(body.position).add(_v1), body.quaternion);
      body.setShape(limbCapsule(keep, r),
        { mass: clamp(keep * r * r * (this._perVolume ?? 260), 0.35, this.mass * 0.4) });
      const holder = this.holders.get(boneName);
      if (holder && holder.children[0]) holder.children[0].position.y = -keep * 0.5;
      bone.cutT *= t;
      this.severedCount++;
    }
    if (body && impulse) body.applyImpulse(impulse, body.position);
    return broke;
  }

  /**
   * HOLD IT UP BY THE CHEST, and let everything else hang.
   *
   * Note 48: "held bodies have real limb physics as you swing them." A gripped
   * enemy used to be moved rigidly — `dampVec(position, liftTarget)` with the
   * animator still walking its legs — so the most cinematic thing in the source
   * material was a droid sliding through the air in a jogging pose.
   *
   * This is the whole of the other way: ragdoll it, then drive ONE body toward
   * the hold point every frame and leave the joints to do the rest. The arms
   * fall, the head lolls, the legs trail, and swinging the mouse swings a
   * hundred and thirty kilos of joint solve rather than a rigid transform. It
   * is also almost free — the ragdoll already exists for corpses, and this adds
   * a velocity write per frame.
   *
   * A VELOCITY, not a teleport. Setting the position directly would leave every
   * other bone behind and let the solver tear the shoulders off — the same
   * failure the cape had through a somersault, one layer down. Driving the
   * chest at the speed that closes the gap keeps the joints inside their
   * budget, and `clampLength` is what stops a grip across the arena arriving as
   * an explosion.
   */
  suspend(target, dt, strength = 12) {
    if (!this.ragdolled) return false;
    const b = this.bodies.get('chest') || this.bodies.get('spine') || this.bodies.get('hips');
    if (!b) return false;
    b.wake?.();
    _v1.subVectors(target, b.position);
    b.velocity.copy(_v1).multiplyScalar(strength).clampLength(0, 26);
    // A held body turns slowly under its own weight rather than spinning.
    b.angularVelocity.multiplyScalar(Math.max(0, 1 - dt * 3));
    return true;
  }

  centre(out = new THREE.Vector3()) {
    if (this.ragdolled) {
      const b = this.bodies.get('chest') || this.bodies.get('spine') || this.bodies.get('hips');
      if (b) return out.copy(b.position);
    }
    return this.rig.worldPos('chest', out);
  }

  update(dt) {
    if (this.ragdolled) this.syncRagdoll();
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      if (!this.pieces[i].update(dt)) this.pieces.splice(i, 1);
    }
  }

  dispose() {
    for (const b of this.bodies.values()) this.physics.remove(b);
    for (const h of this.holders.values()) {
      h.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this.scene.remove(h);
    }
    for (const p of this.pieces) p.dispose();
    this.pieces.length = 0;
    this.scene.remove(this.rig.root);
    this.rig.dispose();
  }
}

function stripSide(n) { return n.replace(/[LR]$/, ''); }

const JOINT_LIMITS = {
  spine:  { cone: 0.42, twist: 0.32, stiff: 3.0 },
  chest:  { cone: 0.36, twist: 0.30, stiff: 3.0 },
  neck:   { cone: 0.55, twist: 0.40, stiff: 2.2 },
  head:   { cone: 0.50, twist: 0.35, stiff: 2.2 },
  clav:   { cone: 0.30, twist: 0.20, stiff: 4.0 },
  arm:    { cone: 1.35, twist: 0.90, stiff: 0.4 },
  fore:   { cone: 1.55, twist: 0.55, stiff: 0.6 },
  hand:   { cone: 0.75, twist: 0.45, stiff: 1.2 },
  thigh:  { cone: 1.05, twist: 0.45, stiff: 0.8 },
  shin:   { cone: 1.25, twist: 0.25, stiff: 1.0 },
  foot:   { cone: 0.55, twist: 0.30, stiff: 1.4 },
  femur:  { cone: 1.1, twist: 0.5, stiff: 0.7 },
  tibia:  { cone: 1.2, twist: 0.3, stiff: 0.9 },
  tarsus: { cone: 0.7, twist: 0.3, stiff: 1.1 },
  hipL:   { cone: 0.6, twist: 0.3, stiff: 2.0 },
  body:   { cone: 0.3, twist: 0.2, stiff: 4.0 },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Detached piece — the part that comes away                             */
/* ══════════════════════════════════════════════════════════════════════ */

export class DetachedPiece {
  constructor(scene, physics, bladeColor) {
    this.id = _pieceId++;
    this.scene = scene;
    this.physics = physics;
    this.bladeColor = bladeColor;
    this.entries = [];        // { body, holder }
    this.joints = [];         // what holds a severed forearm to its hand
    this.age = 0;
    this.lifetime = 26 + rng() * 10;
    this.dead = false;
  }

  /** The far half of the bone that was cut. */
  addStub(bone, keepLen, dropLen, rCut, rEnd, limbInfo) {
    bone.obj.updateMatrixWorld(true);
    _m1.copy(bone.obj.matrixWorld);
    _q1.setFromRotationMatrix(_m1);
    _v1.setFromMatrixPosition(_m1).add(_v2.set(0, keepLen, 0).applyQuaternion(_q1));

    const holder = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.y = -dropLen * 0.5;
    holder.add(inner);

    const geo = limbGeo(dropLen, rCut, rEnd, limbInfo ? limbInfo.seg : 8, true);
    const m = new THREE.Mesh(geo, bone.primary ? bone.primary.material : new THREE.MeshStandardMaterial());
    m.castShadow = true; m.receiveShadow = true;
    m.userData.limb = { r0: rCut, r1: rEnd, seg: limbInfo ? limbInfo.seg : 8 };
    inner.add(m);

    const cap = capMesh(rCut * 1.02, this.bladeColor);
    cap.rotation.x = Math.PI / 2;
    inner.add(cap);

    holder.position.copy(_v1).add(_v3.set(0, dropLen * 0.5, 0).applyQuaternion(_q1));
    holder.quaternion.copy(_q1);
    this.scene.add(holder);

    const r = Math.max(0.026, rCut);
    const body = new Body({
      position: holder.position, quaternion: _q1,
      shape: limbCapsule(dropLen, r),
      spheres: capsuleSpheres(Math.max(0.001, dropLen * 0.5 - r * 0.5), r, 'y', 2),
      mass: clamp(dropLen * r * r * 300, 0.4, 12),
      friction: 0.8, restitution: 0.04, inertiaScale: 3, layer: LAYER.DEBRIS,
      mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.PROP | LAYER.PLAYER,
    });
    this.physics.add(body);
    this.entries.push({ body, holder, boneName: bone.name, len: dropLen });
    this._rootBody = body;
    this._rootQuat = _q1.clone();
  }

  /** A whole bone that came away with the cut. */
  addBone(bone) {
    if (bone.parts.length === 0) {
      // nothing visual — still take its children along
      return;
    }
    bone.obj.updateMatrixWorld(true);
    _m1.copy(bone.obj.matrixWorld);
    _q1.setFromRotationMatrix(_m1);
    _v1.setFromMatrixPosition(_m1);
    const len = Math.max(0.03, bone.length * bone.cutT);
    const r = Math.max(0.026, bone.radius * 0.9);

    const holder = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.y = -len * 0.5;
    holder.add(inner);
    for (let i = bone.obj.children.length - 1; i >= 0; i--) {
      const c = bone.obj.children[i];
      if (c.userData.boneChild) continue;
      inner.add(c);
      // A DETACHED PIECE IS ALWAYS VISIBLE, WHATEVER THE VIEW WAS HIDING.
      //
      // These are the body's real meshes being reparented, not copies, so any
      // `visible = false` on them comes along. First person hides the neck, the
      // head and its fifteen face meshes, and the clavicles, precisely because
      // the player is inside them — so cutting your own head off in first
      // person spawned a piece with no head on it, and the limb it was attached
      // to went with it. Dismemberment is not a view mode.
      c.visible = true;
    }
    holder.position.copy(_v1).add(_v2.set(0, len * 0.5, 0).applyQuaternion(_q1));
    holder.quaternion.copy(_q1);
    this.scene.add(holder);

    const body = new Body({
      position: holder.position, quaternion: _q1,
      shape: limbCapsule(len, r),
      spheres: capsuleSpheres(Math.max(0.001, len * 0.5 - r * 0.5), r, 'y', 2),
      mass: clamp(len * r * r * 300, 0.3, 14),
      friction: 0.8, restitution: 0.03, inertiaScale: 3, layer: LAYER.DEBRIS,
      mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.PROP | LAYER.PLAYER,
    });
    this.physics.add(body);
    this.entries.push({ body, holder, boneName: bone.name, len, bone });
  }

  /** Decorative geometry (armour plate, cloth panel) that sat past the cut. */
  adoptDecor(obj, bone, keepLen) {
    if (!this.entries.length) return;
    const target = this.entries[0];
    obj.position.y -= keepLen + target.len * 0.5;
    target.holder.children[0].add(obj);
    obj.visible = true;                  // see addBone: a piece is never hidden
  }

  finalise(impulse, cutPoint, spin = 1) {
    // join the pieces so a severed forearm+hand stays a forearm+hand
    for (let i = 1; i < this.entries.length; i++) {
      const e = this.entries[i];
      const parentName = e.bone?.parent?.name;
      const parent = this.entries.find(x => x.boneName === parentName) || this.entries[0];
      if (!parent) continue;
      const anchorA = _v1.copy(e.bone ? e.bone.offset : _v3.set(0, 0, 0))
        .setY((e.bone ? e.bone.offset.y : 0) - parent.len * 0.5);
      const anchorB = _v2.set(0, -e.len * 0.5, 0);
      const lim = JOINT_LIMITS[stripSide(e.boneName)] || { cone: 1.0, twist: 0.5 };
      this.joints.push(this.physics.addJoint(new RagdollJoint(parent.body, e.body, anchorA, anchorB, {
        coneAngle: lim.cone, twistLimit: lim.twist,
        stiffness: 0, damping: 0.25,
        restQuat: e.bone ? e.bone.restQuat.clone() : new THREE.Quaternion(),
      })));
    }
    if (impulse) {
      for (const e of this.entries) {
        // Written straight onto the body rather than queued as an impulse: the
        // piece is brand new and has not been stepped, so gameplay reading its
        // velocity this frame — the blade, the particle trail — has to see the
        // blade's momentum already in it. The spin is overwritten anyway, which
        // is why the torque an off-centre impulse would add is not worth having.
        e.body.velocity.addScaledVector(impulse, 0.34);
        e.body.angularVelocity.set(
          (rng() - 0.5) * 9 * spin, (rng() - 0.5) * 9 * spin, (rng() - 0.5) * 9 * spin);
        e.body.wake();
      }
    }
    for (const e of this.entries) e.body.userData.onCull = () => { this._removeEntry(e); };
  }

  _removeEntry(e) {
    e.holder.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(e.holder);
    e.removed = true;
  }

  update(dt) {
    this.age += dt;
    let alive = false;
    for (const e of this.entries) {
      if (e.removed) continue;
      alive = true;
      e.holder.position.copy(e.body.position);
      e.holder.quaternion.copy(e.body.quaternion);
      if (this.age > this.lifetime) {
        const k = clamp((this.age - this.lifetime) / 2.5, 0, 1);
        e.holder.scale.setScalar(Math.max(0.001, 1 - k));
        if (k >= 1) { this.physics.remove(e.body); this._removeEntry(e); }
      }
    }
    if (!alive) { this.dead = true; return false; }
    return true;
  }

  dispose() {
    for (const e of this.entries) {
      if (e.removed) continue;
      this.physics.remove(e.body);
      this._removeEntry(e);
    }
  }
}
