/**
 * SABER — enemies.
 *
 * Everything here respects the same rules the player does: real limbs on a
 * real skeleton, real ragdolls, real cuts wherever the blade crossed. A droid
 * whose leg comes off falls over because it has no leg, not because it played
 * the falling-over animation.
 */

import * as THREE from 'three';
import { Actor } from './Ragdoll.js';
import { Rig, BipedAnimator, aimY } from './Rig.js';
import { buildB1, buildB2, buildTrooper, buildAcolyte, buildDroideka, buildWalker, buildBeast, buildBlaster, plateGeo } from './Bodies.js';
import { Saber } from './Saber.js';
import { dropSaber } from './Dropped.js';
import { DuelBrain, Telegraph, FORMS, FORM_KEYS, TIER, guardQuat } from './Duel.js';
import { buildRemote } from './Dojo.js';
import { attachCloak, attachSkirt } from './Cloth.js';
import { LAYER, Body, capsuleSpheres, capsule } from '../physics/RapierWorld.js';
import { supportHeight, STEP_UP, GROUND_SNAP } from '../physics/Support.js';
import { TOUGHNESS, bladesTouching } from './Combat.js';
import { segmentSegment } from '../physics/Physics.js';
import { BOLT_COLORS } from './Bolts.js';
import { clamp, lerp, damp, smoothstep, makeRng, TAU, dampVec } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(4711);

/**
 * How fast a body gives ground, as a share of its forward speed. Sprinters
 * backpedal at roughly half their forward pace and fighters rather less, since
 * they are also keeping their guard up. At 1.0 — which is what this was, by
 * omission — an enemy retreated as fast as it charged, and that reads as
 * unnatural at any approach speed.
 */
const BACKPEDAL = 0.5;

/**
 * How much wider than the body a blade's contact is.
 *
 * A lightsaber's core is 3 cm and it burns rather than bruises, so touching a
 * body at all is a cut — but a hit test that demands the blade's centreline
 * come inside the torso's own radius misses every glancing pass and reads as
 * the blade going through you. The player's own solver takes the capsule
 * radius plus the blade's, and this is the same allowance for the one capsule
 * the player presents.
 */
const BLADE_BITE = 0.10;

/**
 * Slow the part of a desired velocity that points AWAY from `toTarget`, leaving
 * everything across that line alone. Exported because it is a numeric law and
 * numeric laws in this codebase get measured, not eyeballed: a sidestep must
 * keep its full pace while a retreat loses half of it, and the only way to know
 * that is still true is to assert it.
 */
export function limitBackpedal(vel, toTarget, factor = BACKPEDAL) {
  const away = -(vel.x * toTarget.x + vel.y * toTarget.y + vel.z * toTarget.z);
  if (away > 0) vel.addScaledVector(toTarget, away * (1 - factor));
  return vel;
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _box = new THREE.Box3(), _box2 = new THREE.Box3();
/** The off-hand pose's own scratch — see _poseOffhand for why it needs it. */
const _o1 = new THREE.Vector3(), _o2 = new THREE.Vector3(), _o3 = new THREE.Vector3();
const _o4 = new THREE.Vector3(), _o5 = new THREE.Vector3(), _o6 = new THREE.Vector3();
/** The closest point the blade came to a body this frame — see _saberStrike. */
const _hit = new THREE.Vector3();
const _oq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let _enemyId = 1;

/* ── archetypes ──────────────────────────────────────────────────────── */

export const ARCHETYPES = {
  b1: {
    label: 'B1 Battle Droid', build: buildB1, scale: 1.02, hp: 28, mass: 52,
    speed: 3.5, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 1.5, burst: 3, burstGap: 0.13, spread: 0.075, damage: 9,
    preferred: [7, 15], boltColor: BOLT_COLORS.red, score: 100, threat: 1,
    voice: 'droid', hipHeight: 0.96,
  },
  b2: {
    label: 'B2 Super Battle Droid', build: buildB2, scale: 1.18, hp: 96, mass: 130,
    speed: 2.6, toughness: TOUGHNESS.armour, ranged: true, weapon: null,
    fireRate: 1.9, burst: 4, burstGap: 0.1, spread: 0.05, damage: 13,
    preferred: [6, 13], boltColor: BOLT_COLORS.red, score: 300, threat: 3,
    armored: true, hipHeight: 1.1,
  },
  trooper: {
    label: 'Clone Trooper', build: buildTrooper, scale: 1.0, hp: 46, mass: 78,
    speed: 4.1, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 1.35, burst: 3, burstGap: 0.11, spread: 0.045, damage: 12,
    preferred: [9, 19], boltColor: BOLT_COLORS.blue, score: 180, threat: 2,
    grenades: true, hipHeight: 0.95,
  },
  sniper: {
    label: 'Marksman', build: buildTrooper, scale: 1.0, hp: 38, mass: 76,
    speed: 3.6, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 3.4, burst: 1, spread: 0.004, damage: 34, telegraph: 1.0,
    preferred: [22, 42], boltColor: BOLT_COLORS.gold, score: 320, threat: 3,
    trooperColor: 0x2c3038, accent: 0xff9a20, hipHeight: 0.95,
  },
  acolyte: {
    label: 'Sith Acolyte', build: buildAcolyte, scale: 1.04, hp: 130, mass: 82,
    speed: 5.0, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 4, damage: 26, preferred: [1.6, 3.4], score: 700, threat: 6,
    hipHeight: 0.97,
  },
  droideka: {
    label: 'Droideka', build: buildDroideka, scale: 1.5, hp: 170, mass: 210,
    speed: 3.0, toughness: TOUGHNESS.armour, ranged: true, custom: 'droideka',
    fireRate: 0.72, burst: 6, burstGap: 0.07, spread: 0.055, damage: 8,
    preferred: [8, 16], boltColor: 0x66ff99, score: 550, threat: 5, shield: true,
  },
  walker: {
    label: 'Spider Walker', build: buildWalker, scale: 2.4, hp: 620, mass: 900,
    speed: 2.4, toughness: TOUGHNESS.heavy, ranged: true, custom: 'walker',
    fireRate: 2.6, burst: 2, burstGap: 0.22, spread: 0.03, damage: 26, big: true,
    preferred: [12, 26], boltColor: BOLT_COLORS.gold, score: 1600, threat: 12,
  },
  /* ── dojo only ── */
  remote: {
    label: 'Training Remote', build: buildRemote, scale: 1.0, hp: 4, mass: 3,
    speed: 2.6, toughness: TOUGHNESS.plastoid, ranged: true, custom: 'remote',
    fireRate: 2.0, burst: 1, spread: 0.02, damage: 3, float: 1.55,
    preferred: [4.5, 7.5], boltColor: 0xffc040, score: 0, threat: 0, training: true,
  },
  dummy: {
    label: 'Training Droid', build: buildB1, scale: 1.02, hp: 999, mass: 52,
    speed: 0, toughness: TOUGHNESS.droid, inert: true,
    preferred: [0, 0], score: 0, threat: 0, training: true,
  },
  sparring: {
    label: 'Sparring Partner', build: buildAcolyte, scale: 1.04, hp: 400, mass: 82,
    speed: 3.4, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 1, hilt: 'Guardian', damage: 3, preferred: [1.6, 3.2],
    score: 0, threat: 0, training: true,
  },

  beast: {
    label: 'Acklay', build: buildBeast, scale: 2.9, hp: 900, mass: 1400,
    speed: 4.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 42, preferred: [2.5, 5], score: 2400, threat: 16, boss: true,
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Modifiers — the same eight bodies, at depth                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A wave-20 trooper used to be a wave-2 trooper with more friends. Escalation
 * was one number — the director's budget — so depth bought QUANTITY and never
 * anything else, and the fight you learned at wave 5 was the fight you were
 * still having at wave 25.
 *
 * A modifier is an elite variant applied on spawn. Three rules hold it honest:
 *
 * 1. IT IS DATA. A modifier is a patch on the archetype (`scale` multiplies,
 *    `set` replaces) plus an optional `install` for the parts that are meshes
 *    and behaviour. `applyModifier` copies the archetype before patching, so an
 *    elite carries its own `A` and nothing an elite does can leak back into the
 *    shared table and follow the player into their next run. Anything headless —
 *    the balance harness, the checks below — can read the whole escalation model
 *    off this object without executing a frame.
 *
 * 2. IT IS PAID FOR. `modifierThreat` is what the wave director spends, and it
 *    is a function of the BASE archetype: a shielded droid and a shielded
 *    droideka are not the same purchase. An elite wave costs the same threat as
 *    a plain one, so depth changes the SHAPE of a wave rather than secretly
 *    tripling it. `tools/checks/escalation.mjs` asserts the queue never spends
 *    more than the budget.
 *
 * 3. IT READS AT ENGAGEMENT RANGE. Every modifier below names the tell it puts
 *    on the body, and each tell is either on a bone's PRIMARY mesh — which the
 *    LOD never culls, because it is the silhouette — or a mesh added after the
 *    constructor's `_collectLodParts` ran, which is therefore not in `_lodParts`
 *    and never hidden either. A difficulty you cannot see coming is not
 *    difficulty, it is a surprise.
 *
 * And everything here survives being cut apart, because everything in this game
 * is cut apart. Geometry a modifier adds is parented to a BONE, so `Actor.cut`
 * hands it to the DetachedPiece with the limb it was sitting past, and
 * `Actor.goRagdoll` re-homes it onto that bone's holder — the same two paths
 * every rivet and armour plate in Bodies.js already travels. Nothing is
 * parented to `rig.root`, where it would be orphaned the moment the body fell.
 */

/** How much of a leader's aura a nearby ally gets, and how far it reaches. */
export const RALLY = { radius: 9.5, speed: 1.15, damage: 1.25, rate: 0.78, refresh: 0.25 };

/** The unstable core: how long the fuse burns, and what the blast is worth. */
export const UNSTABLE = { fuse: 0.85, radius: 5.0, damage: 34, impulse: 15 };

/**
 * What an elite deflector holds, as a share of the body's own health — bounded
 * at both ends. Unbounded it read `maxHp * 2.2`, which is 62 on a B1 (a rounding
 * error) and 1364 on a walker (more than everything else in the wave put
 * together). The droideka's own generator carries 260; an elite's sits either
 * side of it.
 */
function shieldPool(maxHp) { return clamp(maxHp * 1.6, 90, 300); }

export const MODIFIERS = {
  frenzied: {
    label: 'Frenzied',
    // The tell is MOTION first — it arrives while its wave is still walking —
    // backed by a hot rim on the limb tubes so a still one still reads.
    tell: 'half again as fast as everything around it, and lit from the inside',
    since: 3,
    threat: { mul: 0.95, flat: 1.4 },
    allow: (A) => !A.boss && !A.big && !A.inert && !A.training && A.speed > 0,
    scale: { hp: 0.58, speed: 1.5, fireRate: 0.68, score: 1.4 },
    install: (e) => tintBones(e, 0xff3a12, 1.5),
  },

  shielded: {
    label: 'Shielded',
    tell: 'a deflector bubble a metre across, lit and rippling',
    since: 6,
    threat: { mul: 1.0, flat: 3.2 },
    // A droideka already has one; a second is not a modifier, it is a typo.
    allow: (A) => !A.boss && !A.inert && !A.training && !A.shield,
    scale: { speed: 0.94, score: 1.6 },
    install: installShield,
  },

  marksman: {
    label: 'Marksman',
    // The red targeting line and its rising tone: 0.9 s of warning, drawn from
    // the muzzle to your chest, which is the whole of the counter-play.
    tell: 'a red targeting line on your chest, and most of a second to leave it',
    since: 7,
    threat: { mul: 0.9, flat: 2.8 },
    allow: (A) => A.ranged && !A.custom && !A.telegraph && !A.training,
    scale: { damage: 2.4, fireRate: 1.4, score: 1.5 },
    set: { telegraph: 0.9, burst: 1, spread: 0.006, boltColor: BOLT_COLORS.gold, preferred: [20, 38] },
    install: (e) => { tintBones(e, 0xff8a10, 0.45); addScope(e); },
  },

  unstable: {
    label: 'Unstable',
    tell: 'a reactor core pulsing through the chest, and a fuse you can hear',
    since: 5,
    threat: { mul: 0.85, flat: 1.8 },
    allow: (A) => !A.boss && !A.inert && !A.training,
    scale: { hp: 0.75, score: 1.3 },
    install: installCore,
  },

  armoured: {
    label: 'Armoured',
    tell: 'plated shoulders, chest and thighs, and a dead metal finish',
    since: 8,
    // The dearest modifier on a heavy chassis, and it should be: a durasteel
    // torso takes the blade's fastest route away entirely, so an armoured
    // acolyte is not 1.5 acolytes, it is nearer three. Priced against that
    // measurement rather than against how the number looks.
    threat: { mul: 2.0, flat: 2.6 },
    // Rig-built humanoids only: the plates are authored against a humanoid
    // skeleton and a walker has no clavicles to hang them from.
    allow: (A) => !A.custom && !A.boss && !A.inert && !A.training,
    scale: { hp: 1.5, speed: 0.86, score: 1.7 },
    // `armorPlus` is read by _boneToughness: the TORSO goes to durasteel, the
    // limbs do not. The counter-play is that the legs are still legs.
    set: { armorPlus: true },
    install: installPlates,
  },

  dualist: {
    label: 'Dual-Wielding',
    tell: 'two lit blades — the brightest thing in the wave, at any range',
    since: 9,
    threat: { mul: 1.25, flat: 3.6 },
    allow: (A) => !!A.saber && !!A.melee && !A.boss && !A.training,
    scale: { damage: 1.12, score: 1.8 },
    install: installOffhand,
  },

  leader: {
    label: 'Leader',
    tell: 'a standard burning on its back, and a ring on the ground showing exactly who it is helping',
    since: 11,
    threat: { mul: 1.4, flat: 5.0 },
    allow: (A) => !A.boss && !A.big && !A.inert && !A.training,
    scale: { hp: 1.5, score: 2.2 },
    install: installStandard,
  },
};

export const MODIFIER_KEYS = Object.keys(MODIFIERS);

/**
 * What the director pays for one elite, in the same currency as `A.threat`.
 *
 * A function of the BASE archetype rather than a flat surcharge, because
 * "shielded" is worth more bolted to a droideka than to a B1 and a flat number
 * would make elite B1s the cheapest threat in the game.
 */
export function modifierThreat(type, key) {
  const A = ARCHETYPES[type];
  if (!A) return 0;
  const M = MODIFIERS[key];
  if (!M) return A.threat;
  return A.threat * M.threat.mul + M.threat.flat;
}

/** Which modifiers this archetype can wear at all. */
export function modifiersFor(type) {
  const A = ARCHETYPES[type];
  if (!A) return [];
  return MODIFIER_KEYS.filter(k => MODIFIERS[k].allow(A));
}

/**
 * Promote a freshly spawned enemy to an elite.
 *
 * Post-construction because `World.spawnEnemy(type, pos)` is the only door in
 * and it takes no options — so the numbers the constructor read off the shared
 * archetype are re-derived here rather than being read twice. Health is reset
 * outright (a spawn is at full), while speed and damage are SCALED so the
 * per-body jitter and the difficulty factor the constructor rolled survive.
 *
 * @returns {boolean} whether the modifier actually went on.
 */
export function applyModifier(e, key) {
  const M = MODIFIERS[key];
  if (!e || !M || e.mod || e.dead) return false;
  const base = e.A;
  if (!M.allow(base)) return false;

  const A = { ...base };
  for (const [k, v] of Object.entries(M.scale || {})) {
    if (typeof A[k] === 'number') A[k] *= v;
  }
  Object.assign(A, M.set || {});
  A.label = `${M.label} ${base.label}`;
  A.threat = modifierThreat(e.type, key);
  A.elite = key;
  e.A = A;
  e.mod = key;
  e.modLabel = M.label;

  e.maxHp = A.hp * (e.world.hpScale ?? 1);
  e.hp = e.maxHp;
  e.speed *= M.scale?.speed ?? 1;
  e.attackDamage *= M.scale?.damage ?? 1;
  // The duel brain reads timeScale as "how fast this form runs"; a frenzied
  // duellist has to actually swing faster, not merely walk faster.
  if (e.duel && M.scale?.fireRate) e.duel.timeScale /= M.scale.fireRate;

  M.install?.(e);
  return true;
}

/* ── the tells ───────────────────────────────────────────────────────── */

const _tintTarget = new THREE.Color();

/**
 * Recolour the bone PRIMARIES — the limb tubes — and nothing else.
 *
 * The primaries are the one part of a body the LOD never culls (see
 * `_applyLod`: `keep` is exactly `bone.primary`), so a tint on them is the only
 * colour signal that survives out to the 56 m spawn ring. Materials are CLONED
 * first: Bodies.js hands every B1 in the wave the same MeshStandardMaterial
 * instance, and tinting it in place would turn the whole army red.
 */
function tintBones(e, hex, strength = 1) {
  _tintTarget.setHex(hex);
  const cloned = e._modMaterials || (e._modMaterials = []);
  const paint = (m) => {
    if (!m || !m.material || Array.isArray(m.material)) return;
    const mat = m.material.clone();
    if (mat.emissive) {
      mat.emissive.copy(_tintTarget);
      mat.emissiveIntensity = strength;
    }
    if (mat.color) mat.color.lerp(_tintTarget, Math.min(0.35 * strength, 0.55));
    m.material = mat;
    cloned.push(mat);
  };
  if (e.rig) {
    for (const b of e.rig.list) paint(b.primary);
    return;
  }
  // A droideka is a baked group rather than a bone rig, and it can wear the
  // same modifiers. Its meshes ARE its silhouette — Kit bakes them down to a
  // handful — so painting them all is the same claim on the same channel, not
  // a second implementation of the tell.
  if (e.group) e.group.traverse((o) => { if (o.isMesh) paint(o); });
}

/** The shell material for an elite deflector — the droideka's, standalone. */
function eliteShieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x7fe6ff) }, uTime: { value: 0 }, uPower: { value: 0.85 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal);
        vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float fres = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.2);
        float hexes = sin(vP.x*22.0)*sin(vP.y*22.0)*sin(vP.z*22.0);
        float ripple = 0.5+0.5*sin(vP.y*12.0 - uTime*3.4);
        float a = (fres*0.9 + max(hexes,0.0)*0.16 + ripple*0.06) * uPower;
        gl_FragColor = vec4(uColor*(a*2.4), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/**
 * A deflector bubble on a body that was not built with one.
 *
 * Scene-parented rather than bone-parented, and driven from `aimPoint` every
 * frame: a bubble hung off the chest bone would ride the ragdoll and leave a
 * corpse glowing, and one hung off `rig.root` would not move at all, because
 * this rig's bones are posed in world space under a root that never leaves the
 * origin. `die()` hides it, `dispose()` frees it.
 */
function installShield(e) {
  const S = e.A.scale ?? 1;
  // A humanoid's bubble wraps the whole body; a walker's deliberately does NOT
  // reach its feet. `1.9 * S` on a 2.4-scale chassis is a four-and-a-half metre
  // sphere with the legs inside it and no way past, and "no way past" is not a
  // modifier, it is an invulnerability. Chassis covered, legs exposed — the same
  // bargain Armoured strikes with its durasteel torso.
  const r = e.A.big ? 2.6 : 1.05 * S;
  const mat = eliteShieldMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  mesh.frustumCulled = false;
  mesh.position.copy(e.shieldCentre());
  e.world.scene.add(mesh);
  e.shieldMesh = mesh;
  e.shieldMat = mat;
  e.shieldRadius = r;
  e.shieldMax = shieldPool(e.maxHp);
  e.shieldHp = e.shieldMax;
  e.shieldUp = true;
  e.deployTimer = 0;
}

/**
 * A reactor that is about to stop being one.
 *
 * Parented to the chest bone so it goes where the chest goes: severed with the
 * torso it rides the DetachedPiece, and on a ragdoll `goRagdoll` re-homes it
 * onto the chest's holder. Both paths force `visible = true`, which is why this
 * is a mesh on a bone and not a sprite bolted to the scene.
 */
function installCore(e) {
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5a20, toneMapped: false,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12 * S, 10, 8), mat);
  const host = e.rig?.get('chest') || e.rig?.get('spine') || e.rig?.get('body');
  if (host) { mesh.position.set(0, host.length * 0.5, 0.1 * S); host.obj.add(mesh); }
  else if (e.group) { mesh.position.y = 0.6 * S; e.group.add(mesh); }
  else return;
  e.coreMesh = mesh;
  (e._modMaterials || (e._modMaterials = [])).push(mat);
  e.fuse = 0;
}

/**
 * Plate the torso and the big limbs.
 *
 * Every plate is a child of the bone it armours, which is what makes it behave:
 * cut the thigh and the thigh plate leaves with the leg, because `Actor.cut`
 * adopts any child sitting past the cut into the piece; cut above it and it
 * stays on the stub. `noDetach` is deliberately NOT set — an armour plate is
 * part of the limb, not part of the body.
 */
function installPlates(e) {
  if (!e.rig) return;
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.42, metalness: 0.85 });
  (e._modMaterials || (e._modMaterials = [])).push(mat);
  const plates = e._modMeshes || (e._modMeshes = []);
  const bolt = (boneName, w, h, d, y, z = 0) => {
    const b = e.rig.get(boneName);
    if (!b) return;
    const m = new THREE.Mesh(plateGeo(w * S, h * S, d * S, 0.01 * S, 1), mat);
    m.position.set(0, y * b.length, z * S);
    m.castShadow = true;
    b.obj.add(m);
    plates.push(m);
  };
  bolt('chest', 0.40, 0.30, 0.30, 0.5, 0.03);
  bolt('spine', 0.36, 0.22, 0.28, 0.5, 0.02);
  bolt('armL', 0.20, 0.16, 0.20, 0.16);
  bolt('armR', 0.20, 0.16, 0.20, 0.16);
  bolt('thighL', 0.17, 0.26, 0.17, 0.42);
  bolt('thighR', 0.17, 0.26, 0.17, 0.42);
  tintBones(e, 0x3a4048, 0.12);
}

/** A long optic on the blaster, so the shooter reads before the laser does. */
function addScope(e) {
  if (!e.weapon) return;
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.7 });
  const glass = new THREE.MeshBasicMaterial({ color: 0xff8a10, toneMapped: false });
  (e._modMaterials || (e._modMaterials = [])).push(mat, glass);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * S, 0.017 * S, 0.26 * S, 8), mat);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.055 * S, 0.10 * S);
  e.weapon.add(tube);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016 * S, 8), glass);
  lens.position.set(0, 0.055 * S, -0.072 * S);
  lens.rotation.y = Math.PI;
  e.weapon.add(lens);
  (e._modMeshes || (e._modMeshes = [])).push(tube, lens);
}

/**
 * A second blade in the off hand.
 *
 * It is a real Saber, posed every frame from the left hand, and it is the
 * loudest tell in the game — a lit blade is emissive and self-luminous, so it
 * reads at the far end of the spawn ring where a colour tint would not. It also
 * has an answer: `_loseLimbBehaviour` retracts it the moment the left arm comes
 * off, so taking the arm takes the weapon, exactly as it does for the main one.
 */
function installOffhand(e) {
  if (!e.saber || !e.rig) return;
  e.offSaber = new Saber(e.world.scene, {
    colorIndex: e.A.saberColor ?? 4, bladeLength: 1.04, hiltStyle: e.A.hilt ?? 'Sentinel',
  });
  e.offSaber.ignite();
  e.offHand = new THREE.Vector3();
  e.offQuat = new THREE.Quaternion();
  e._offPhase = null;
}

/**
 * A standard on the leader's back, and a ring on the ground under it.
 *
 * The ring is not decoration: it is drawn at exactly `RALLY.radius`, so what
 * the player sees is the literal set of enemies being buffed. The standard is a
 * chest child, so it falls with the body and is gone the moment the leader is.
 */
function installStandard(e) {
  const S = e.A.scale ?? 1;
  const pole = new THREE.MeshStandardMaterial({ color: 0x241f18, roughness: 0.8 });
  const flame = new THREE.MeshBasicMaterial({ color: 0xffc24a, toneMapped: false,
    transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  (e._modMaterials || (e._modMaterials = [])).push(pole, flame);
  const host = e.rig?.get('chest') || e.rig?.get('spine') || e.rig?.get('body');
  // A bone if there is one — so the standard falls with the body and rides the
  // piece it was mounted on — and the baked group otherwise, which is what a
  // droideka has instead of a skeleton.
  const parent = host ? host.obj : e.group;
  if (parent) {
    const base = host ? host.length * 0.35 : 0.55 * S;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * S, 0.026 * S, 1.15 * S, 6), pole);
    staff.position.set(0.13 * S, base, -0.16 * S);
    parent.add(staff);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.10 * S, 10, 8), flame);
    beacon.position.set(0.13 * S, base + 0.60 * S, -0.16 * S);
    parent.add(beacon);
    e.beacon = beacon;
    (e._modMeshes || (e._modMeshes = [])).push(staff, beacon);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb03a, toneMapped: false,
    transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide });
  (e._modMaterials || (e._modMaterials = [])).push(ringMat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(RALLY.radius - 0.28, RALLY.radius, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.frustumCulled = false;
  e.world.scene.add(ring);
  e.rallyRing = ring;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Enemy                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export class Enemy {
  constructor(world, type, spawn) {
    const A = ARCHETYPES[type] || ARCHETYPES.b1;
    this.id = 'e' + (_enemyId++);
    this.type = type;
    this.A = A;
    this.world = world;
    this.team = 1;
    this.dead = false;
    this.dying = 0;
    this.grippable = !A.big && !A.boss;
    this.gripped = false;
    this.liftTarget = null;
    /** Seconds left of the "just dragged off my feet" window a Force pull
     *  opens. Read by Combat.openness; decayed in update. */
    this.yankT = 0;
    /**
     * FORCE COMPEL: who this one is fighting for, and for how long.
     *
     * `{ target, t }`, or null for a mind of its own. The target is an Enemy —
     * possibly THIS enemy — and while it is set, `_think` uses it in place of
     * whatever `ctx.pickTarget` would have said. Everything else about the
     * brain is untouched on purpose: a compelled droid advances, takes cover,
     * leads its shots and calls out exactly as it always did, at the wrong
     * people. A separate "compelled" behaviour would have been a second AI to
     * maintain and would have looked like a different unit.
     */
    this.compelled = null;

    const diff = world.difficulty;
    this.hp = A.hp * (world.hpScale ?? 1);
    this.maxHp = this.hp;
    this.speed = A.speed * (0.9 + rng() * 0.2) * (diff ? lerp(0.86, 1.12, diff.enemyAggression / 1.25) : 1);
    // NOT `damage`: Enemy also has a damage() METHOD, and an instance property
    // of the same name shadows it. That collision silently broke every way of
    // hurting an enemy except the blade — see the note on damage() below.
    this.attackDamage = A.damage * (world.dmgScale ?? 1);

    this.position = spawn.clone();
    this.position.y = world.terrain ? world.terrain.height(spawn.x, spawn.z) : 0;
    this.velocity = new THREE.Vector3();
    this.facing = rng() * TAU;
    this.grounded = true;
    this.knockTimer = 0;
    this.stunTimer = 0;
    this.attackTimer = rng() * 1.2;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.aimCharge = 0;
    this.state = 'approach';
    this.stateTime = 0;
    this.bossPhase = 1;
    this.recentDamage = 0;
    this.windTimer = 0;
    this.strafeDir = rng() < 0.5 ? 1 : -1;
    this.strafeTimer = rng() * 2;
    /** Time left on a Leader's aura. Refreshed by whoever is leading. */
    this.rallyTimer = 0;
    /** Which modifier this body wears, if any — see MODIFIERS. */
    this.mod = null;
    this.fuse = 0;
    this.target = null;
    this.lastSeen = 0;
    this.lod = 0;

    this._build();

    // movement proxy so bodies and players collide with a living enemy
    const r = A.big ? 1.1 : 0.36;
    this.radius = r;
    this.body = new Body({
      position: this.position.clone().setY(this.position.y + (A.big ? 1.4 : 0.9)),
      spheres: capsuleSpheres(A.big ? 0.9 : 0.55, r, 'y', 3),
      shape: capsule(A.big ? 0.9 : 0.55, r),
      mass: A.mass, kinematic: true, layer: LAYER.ENEMY,
      mask: LAYER.WORLD, allowSleep: false, gravityScale: 0,
    });
    this.body.userData.enemy = this;
    world.physics.add(this.body);

    this._caps = [];
    this._capsDirty = true;
    this._collectLodParts();
  }

  /**
   * Rendering LOD.
   *
   * These models carry a lot of small detail — panel lines, rivets, vents,
   * fasteners — and each of those pieces is a draw call. An acolyte is 56
   * meshes and a spider walker 66, so twenty of them on screen is over a
   * thousand draw calls before the shadow pass doubles it. None of that detail
   * is resolvable past about thirty metres.
   *
   * So the detail is CULLED by distance, not just skipped in the solve. The
   * limb tubes the rig builds (bone.primary) always stay, because they are the
   * silhouette and the silhouette is what you fight by; everything else goes.
   * Measured on an acolyte: 56 meshes at LOD 0, 20 at LOD 1, 20 at LOD 2.
   */
  _applyLod(lod) {
    if (!this.rig || !this._lodParts) return;
    const showDetail = lod === 0;
    for (const m of this._lodParts) m.visible = showDetail;
    // far away, drop the shadow pass too — a 60m silhouette contributes
    // nothing to a shadow map that covers 34m
    if (this._lodShadow !== (lod < 2)) {
      this._lodShadow = lod < 2;
      this.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = this._lodShadow; });
    }
  }

  /** Collect the meshes that are decoration rather than silhouette. */
  _collectLodParts() {
    if (!this.rig) return;
    const keep = new Set();
    for (const b of this.rig.list) { if (b.primary) keep.add(b.primary); }
    this._lodParts = [];
    this.rig.root.traverse((o) => {
      if (o.isMesh && !keep.has(o)) this._lodParts.push(o);
    });
    this._lodShadow = true;
  }

  _build() {
    const A = this.A;
    const opts = { scale: A.scale };
    if (this.type === 'sniper') { opts.color = A.trooperColor; opts.accent = A.accent; }
    const built = A.build(opts);
    this.built = built;

    if (built.rig) {
      this.rig = built.rig;
      this.world.scene.add(this.rig.root);
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: A.mass, layer: LAYER.RAGDOLL, bladeColor: 0x57c9ff,
        onSever: (bone, point) => this._onSever(bone, point),
      });
      this.humanoid = !A.custom || A.custom === 'humanoid';
      if (this.humanoid) {
        this.animator = new BipedAnimator(this.rig, { scale: A.scale, hipHeight: A.hipHeight ?? 0.95 });
        this.animator.onFootstep = (p) => {
          if (this.lod > 1) return;
          audio.step(p, this.world.terrain ? this.world.terrain.surfaceAt(p.x, p.z) : 'sand');
          this.world.particles?.sandPuff(p.clone(), 0.16, p.y, this.world.groundColor);
        };
      } else {
        this.walkPhase = rng();
        this.legTargets = [];
      }
    } else {
      // droideka / training remote: a bespoke group rather than a bone rig
      this.group = built.group;
      this.world.scene.add(this.group);
      if (A.custom === 'remote') {
        this.hoverPhase = rng() * TAU;
        this.orbitPhase = rng() * TAU;
      }
    }

    // weapon
    if (A.weapon) {
      this.weapon = buildBlaster(A.weapon);
      const hand = this.rig?.get('handR');
      if (hand) { hand.obj.add(this.weapon); this.weapon.position.set(0, 0.06 * A.scale, 0.02); this.weapon.rotation.x = -0.2; }
    }
    if (A.saber) {
      this.saber = new Saber(this.world.scene, {
        colorIndex: A.saberColor ?? 4, bladeLength: 1.12, hiltStyle: A.hilt ?? 'Sentinel',
      });
      this.saber.ignite();
      this.hum = audio.createHum(this.saber.color.getHex());
      this.hum.ignite();
      this.telegraphArc = new Telegraph(this.world.scene);
      this.duel = new DuelBrain(this, {
        form: A.form || FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)],
        telegraph: this.telegraphArc,
      });
      this.formName = this.duel.describe();
      this.saberHand = new THREE.Vector3();
      this.saberQuat = new THREE.Quaternion();
      this.cloak = attachCloak(this.world.scene, this.rig, {
        scale: A.scale, width: 0.34, length: 0.82, cols: 7, rows: 9, flare: 1.0,
        color: this.type === 'sparring' ? 0x2c3742 : 0x14151a,
      });
      // The robe below the belt, simulated rather than three lathes welded to
      // the pelvis — see Player._makeCloak. It replaces the rigid meshes, so it
      // costs the character fewer triangles than it saves.
      if (built.robeSkirt) {
        this.skirt = attachSkirt(this.world.scene, this.rig, {
          scale: A.scale, rigid: built.robeSkirt,
          color: this.type === 'sparring' ? 0x2c3742 : 0x14151a,
        });
        this.cloak.outer = this.skirt;
      }
    }
    if (A.shield) {
      this.shieldUp = false;
      this.shieldHp = 260;
      this.shieldMax = 260;
      this.deployTimer = 0;
    }
    this._measurePlatform();
  }

  /**
   * THE TOP OF A SPIDER WALKER, AND WHY YOU USED TO FALL THROUGH IT.
   *
   * `Player._supportAt` asks one question of every surface at once — terrain,
   * static boxes, dynamic props — and the comment above it says so: "one query,
   * every surface, highest wins." Enemies were not in the list. `_gatherNear`
   * takes bodies on the PROP, DEBRIS and RAGDOLL layers and skips everything
   * else, so LAYER.ENEMY never reached the query and the player dropped
   * straight through a four-metre chassis as if it were fog. Reported as
   * falling through the giant spiders instead of landing on them.
   *
   * A humanoid gets no platform — landing on a B1's head is not a mechanic, it
   * is a bug with a nicer name. `big` bodies are the walker and the Acklay, and
   * both of them are large enough that leaping onto one and cutting down
   * through it is exactly what the shape of the thing invites.
   *
   * Measured off the built geometry rather than guessed, and measured over the
   * MIDDLE of the hull rather than at its highest point. The bounding box's top
   * is a turret or an antenna at the edge — on the walker that is 0.35 m above
   * the deck, and a player standing there floats over a sloped glacis. So the
   * height is the highest vertex inside the central 60% of the hull's own
   * footprint, which is the flat part you would actually stand on: 1.39 m above
   * the hips bone on a walker, 2.78 on an Acklay.
   *
   * `_poseWalker` puts that bone at `position.y + 1.6·scale` and bobs it with
   * the gait, so the platform bobs too — which is right, and is what makes
   * riding one read as standing on a machine rather than on an invisible shelf.
   */
  _measurePlatform() {
    this.platformTop = 0;
    this.platformRadius = 0;
    if (!this.A.big || !this.rig) return;
    const bone = this.rig.get('body') || this.rig.hipsBone;
    const hips = this.rig.hipsBone;
    if (!bone?.parts?.length || !hips) return;
    this.rig.updateMatrices();
    this.rig.root.updateMatrixWorld(true);
    const hipsY = _v6.setFromMatrixPosition(hips.obj.matrixWorld).y;

    const box = _box.makeEmpty();
    for (const m of bone.parts) if (m.geometry) box.union(_box2.setFromObject(m));
    if (box.isEmpty()) return;
    const halfX = (box.max.x - box.min.x) * 0.5, halfZ = (box.max.z - box.min.z) * 0.5;
    const cx = (box.max.x + box.min.x) * 0.5, cz = (box.max.z + box.min.z) * 0.5;

    const CORE = 0.6;
    let top = -Infinity;
    for (const m of bone.parts) {
      const pos = m.geometry?.attributes?.position;
      if (!pos) continue;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        _v5.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (Math.abs(_v5.x - cx) > halfX * CORE || Math.abs(_v5.z - cz) > halfZ * CORE) continue;
        if (_v5.y > top) top = _v5.y;
      }
    }
    if (!isFinite(top)) return;
    this.platformTop = top - hipsY;
    // The NARROWER of the two half-spans: a deck you can stand on the corner of
    // is a deck you fall off, and erring narrow means the player has to land on
    // the thing rather than beside it.
    this.platformRadius = Math.min(halfX, halfZ);
  }

  /**
   * The deck, in world units, or null if this body has none.
   *
   * Shaped as `{ position, extent }` because that is what `supportHeight`'s
   * dynamic-prop branch already reads, so a rideable enemy is answered by the
   * same query as a crate and the player cannot tell them apart — which is the
   * whole point of Support.js.
   */
  platform() {
    if (!this.platformRadius || this.dead || this.toppled) return null;
    const hips = this.rig?.hipsBone?.obj;
    if (!hips) return null;
    const p = this._plat || (this._plat = { position: new THREE.Vector3(), extent: new THREE.Vector3() });
    p.position.copy(this.position);
    p.extent.set(this.platformRadius, (hips.position.y + this.platformTop) - this.position.y, this.platformRadius);
    return p;
  }

  /* ── queries ─────────────────────────────────────────────────────── */

  /**
   * Where this body is aimed at, floated over and centred on.
   *
   * `rig.worldPos('chest')` alone was wrong for a third of the roster: `Rig`
   * answers a name it does not know with (0, 0, 0), and neither the walker nor
   * the acklay has a chest — their torso bone is called `body`. So every
   * floating notice over an acklay ("WINDED", "CHARGE", a phase banner) was
   * being drawn at the world origin. The chain ends at the body's own position
   * rather than at a bone, so a rig with no torso at all still lands somewhere
   * real.
   */
  aimPoint(out = new THREE.Vector3()) {
    if (this.rig && !this.actor?.ragdolled) {
      for (const name of ['chest', 'body', 'spine', 'hips']) {
        if (this.rig.get(name)) return this.rig.worldPos(name, out);
      }
    }
    if (this.group) return out.copy(this.group.position).addScaledVector(UP, 0.8 * this.A.scale);
    return out.copy(this.position).setY(this.position.y + 1.1 * this.A.scale);
  }

  /**
   * The centre a deflector bubble sits on — geometry, not a bone.
   *
   * Deliberately independent of `aimPoint`: the bubble has to be in the same
   * place on the frame the enemy spawns (before anything has posed the rig) and
   * on the frame it dies, and it has to be right on a chassis whose bones are
   * named nothing in particular.
   */
  shieldCentre(out = new THREE.Vector3()) {
    const S = this.A.scale ?? 1;
    // 1.75·S puts it on a walker's chassis (which _poseWalker holds at 1.6·S
    // above the ground) and 1.02·S on a humanoid's chest. Measured against the
    // posed rigs, not guessed: a bubble half a metre below the body reads as a
    // bug rather than as a shield.
    return out.set(this.position.x, this.position.y + (this.A.big ? 1.75 : 1.02) * S, this.position.z);
  }

  get chestY() { return this.position.y + 1.15 * this.A.scale; }

  /** Capsules the blade solver tests against — one per living bone. */
  capsules() {
    const out = this._caps;
    out.length = 0;
    if (this.dead && !this.actor?.ragdolled) return out;

    // An elite deflector is a sphere around the whole body, so it is in front of
    // every bone and the blade meets it first — which is the point. `takeCut`
    // reads `cap.shield` and drops the bubble instead of the limb, so one clean
    // pass costs the shield and nothing else. Pushed before the bones for the
    // same reason the droideka pushes it before its core.
    if (this.shieldUp && this.shieldMesh && !this.dead) {
      const c = this.shieldCentre(_v4);
      out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
        r: this.shieldRadius, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
    }

    if (this.rig) {
      for (const b of this.rig.list) {
        if (b.severed || !b.parts.length) continue;
        if (this.actor?.ragdolled) {
          const body = this.actor.bodies.get(b.name);
          if (!body) continue;
          const len = b.length * b.cutT;
          _v1.set(0, -len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
          _v2.set(0, len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
        } else {
          b.obj.updateMatrixWorld(false);
          _v1.setFromMatrixPosition(b.obj.matrixWorld);
          _q1.setFromRotationMatrix(b.obj.matrixWorld);
          _v2.copy(_v1).add(_v3.set(0, b.length * b.cutT, 0).applyQuaternion(_q1));
        }
        out.push({
          name: b.name, p0: _v1.clone(), p1: _v2.clone(), r: b.radius * 1.12,
          toughness: this._boneToughness(b.name), enemy: this, vital: VITAL[b.name] ?? 0.4,
        });
      }
    } else if (this.group && this.A.custom === 'remote') {
      const c = _v1.copy(this.group.position);
      out.push({ name: 'core', p0: c.clone(), p1: c.clone(), r: 0.14 * this.A.scale,
        toughness: this.A.toughness, enemy: this, vital: 1 });
    } else if (this.group) {
      // droideka: shield first, then the core
      const c = _v1.copy(this.group.position).addScaledVector(UP, 0.62 * this.A.scale);
      if (this.shieldUp) {
        out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
          r: 1.15 * this.A.scale, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
      }
      out.push({ name: 'core', p0: c.clone(), p1: c.clone().setY(c.y + 0.3 * this.A.scale),
        r: 0.34 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 1 });
      for (const leg of (this.built.legs || [])) {
        leg.leg.getWorldPosition(_v2);
        leg.lower.getWorldPosition(_v3);
        out.push({ name: 'leg' + this.built.legs.indexOf(leg), p0: _v2.clone(), p1: _v3.clone(),
          r: 0.12 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 0.2 });
      }
    }
    return out;
  }

  _boneToughness(name) {
    const A = this.A;
    // The Armoured modifier plates the TORSO to durasteel and leaves the limbs
    // where they were: the counter-play to a body you cannot cut through is the
    // legs it is standing on.
    if (A.armorPlus && /^(chest|spine|hips|neck|head)$/.test(name)) return TOUGHNESS.durasteel;
    if (A.armored && (name === 'chest' || name === 'spine' || name === 'hips')) return TOUGHNESS.heavy;
    if (A.custom === 'walker' && (name === 'body' || name === 'hips')) return TOUGHNESS.durasteel;
    if (A.custom === 'beast' && name === 'body') return TOUGHNESS.heavy;
    return A.toughness;
  }

  /* ── damage ──────────────────────────────────────────────────────── */

  /**
   * Take damage. The attack damage this enemy DEALS is `attackDamage`, and the
   * two must never share a name again: `this.damage = <number>` in the
   * constructor shadowed this method on every instance, so `e.damage(...)`
   * threw "e.damage is not a function" everywhere it was called — deflected
   * bolts, Force lightning, fall damage, net damage. Only the blade could kill
   * anything, and the throw aborted the rest of world.update() on every frame
   * a bolt reached an enemy, which is what made a run degrade until it froze.
   * Nothing failed loudly: the exception surfaced as a console error behind a
   * requestAnimationFrame that had already been scheduled.
   */
  damage(amount, point, source, kind) {
    if (this.dead) return false;
    if (this.invincible) return false;
    if (this.shieldUp && kind !== 'melee') {
      this.shieldHp -= amount;
      // Two kinds of body carry a bubble now — the droideka, which was built
      // with one, and anything the Shielded modifier promoted — so the flash
      // goes through whichever material is actually there rather than assuming
      // `built.shieldMat` exists.
      const mat = this.shieldMat || this.built?.shieldMat;
      if (mat) mat.uniforms.uPower.value = 1.4;
      if (this.shieldHp <= 0) this.dropShield();
      return false;
    }
    this.hp -= amount;
    if (this.A.boss) this.recentDamage = (this.recentDamage || 0) + amount;
    if (this.hp <= 0) { this.die(point, source, kind); return true; }
    if (amount > this.maxHp * 0.22) this.stun(0.28);
    return false;
  }

  /** A blade crossed a limb. */
  takeCut(ev, source) {
    if (this.dead && !this.actor) return;
    const bone = ev.bone;
    const vital = ev.cap.vital ?? 0.4;

    if (ev.cap.shield) { this.dropShield(); return; }

    if (this.actor) {
      const impulse = _v1.copy(ev.impulse).multiplyScalar(0.35);
      if (this.actor.ragdolled) this.actor.cutRagdoll(bone, impulse);
      else this.actor.cut(bone, ev.cutT, impulse, ev.point, { spin: 1.2 });
      this.world.onLimbSevered?.(this, bone, ev.point, source);
    } else if (this.group) {
      this._cutDroideka(bone, ev, source);
    }

    const lethal = vital >= 0.9 || (vital >= 0.7 && this.hp < this.maxHp * 0.55);
    const dmg = lethal ? this.maxHp * 2 : this.maxHp * vital * 1.15;
    this.hp -= dmg;
    if (this.hp <= 0) this.die(ev.point, source, 'cut');
    else {
      this.stun(0.4);
      this._loseLimbBehaviour(bone, ev.point);
    }
  }

  /** @param point where the blade crossed, so a dropped hilt starts there. */
  _loseLimbBehaviour(bone, point) {
    // walking on a severed leg does not work
    if (/thigh|shin|foot|femur|tibia|tarsus/.test(bone)) {
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= (this.A.custom === 'walker' || this.A.custom === 'beast' ? 3 : 1)) {
        this.topple();
      }
    }
    // The off hand holds a real weapon, so losing it loses the weapon. Checked
    // before the general arm rule, which only knows about the main one.
    if (this.offSaber && /L$/.test(bone) && /arm|fore|hand|clav/.test(bone)) {
      this.offSaber.retract();
      this.offDisarmed = true;
    }
    if (/arm|fore|hand/.test(bone)) {
      this.armsLost = (this.armsLost || 0) + 1;
      if (this.armsLost >= 1 && (this.A.ranged || this.A.saber)) {
        this.disarmed = true;
        if (this.weapon) { this.weapon.parent?.remove(this.weapon); this.weapon = null; }
        if (this.saber) {
          /* THE HILT FALLS. It used to simply cease to exist: the most legible
           * thing that can happen in a swordfight — one of you losing your
           * sword — produced nothing you could walk over and pick up. It leaves
           * the severed hand travelling, which is where it was, and note 61's
           * other half is `Player.swapSaber` walking over and taking it. */
          dropSaber(this.world, {
            position: point ? _v1.copy(point) : _v1.copy(this.position).setY(this.position.y + 1.1),
            velocity: _v2.set((rng() - 0.5) * 3, 2.2, (rng() - 0.5) * 3).add(this.velocity),
            colorIndex: this.saber.colorIndex,
            hiltStyle: this.saber.hiltStyle,
            order: this.saber._order ?? null,
            owner: this,
          });
          this.saber.retract();
        }
      }
    }
    if (bone === 'head' || bone === 'neck') { this.blinded = true; this.hp = Math.min(this.hp, this.maxHp * 0.1); }
  }

  _onSever(bone, point) {
    const p = this.world.particles;
    if (p) {
      p.cutFlare(point, null, 0x57c9ff, this.A.big ? 44 : 26);
      if (/droid|b1|b2|walker|droideka/.test(this.type)) p.sparkBurst(point, null, 22, { speed: 8 });
    }
    audio.cut(point, this.A.big);
  }

  _cutDroideka(name, ev, source) {
    const idx = parseInt(name.replace('leg', ''), 10);
    if (!isNaN(idx) && this.built.legs[idx] && !this.built.legs[idx].gone) {
      const leg = this.built.legs[idx];
      leg.gone = true;
      leg.leg.getWorldPosition(_v1);
      const mesh = leg.leg;
      mesh.parent.remove(mesh);
      this.world.spawnDebrisGroup(mesh, _v1, ev.impulse.clone().multiplyScalar(0.3), 0.4);
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= 2) this.topple();
    }
  }

  topple() {
    if (this.toppled || this.dead) return;
    this.toppled = true;
    this.stun(9999);
    if (this.actor && !this.actor.ragdolled) {
      this.actor.goRagdoll(this.velocity.clone(), _v1.set((rng() - .5) * 4, 0, (rng() - .5) * 4));
      this.world.physics.remove(this.body);
      this.bodyRemoved = true;
    }
  }

  applyKnockback(impulse, damage, source, gentle) {
    if (this.dead) {
      if (this.actor?.ragdolled) {
        for (const b of this.actor.bodies.values()) b.applyImpulse(_v1.copy(impulse).multiplyScalar(b.mass * 0.4), b.position);
      }
      return;
    }
    this.velocity.add(impulse);
    this.knockTimer = gentle ? 0.35 : 0.7;
    this.grounded = false;
    if (damage > 0) this.damage(damage, this.position, source, 'force');
    if (!gentle && impulse.length() > 12 && this.actor && !this.A.boss) {
      // hit hard enough to leave its feet
      this.stun(1.2);
    }
  }

  /**
   * Stunned — and, if it is holding a blade, visibly beaten.
   *
   * Every caller that stuns a duellist has already decided that its guard lost:
   * a parry, a chamber, a lost blade lock, a Force shove, a heavy cut. All of
   * them used to produce a body that stood still for a moment with its guard
   * exactly where it was, which is why "the enemy reacts to being parried" was
   * a thing the code did and not a thing you could see. Routing it through the
   * duel brain gives the same event a blade that is thrown out of line and
   * stays there — see DuelBrain.stagger.
   */
  stun(t, fromDir = null, power = 1) {
    this.stunTimer = Math.max(this.stunTimer, t);
    if (this.duel && !this.dead) this.duel.stagger(t, fromDir, power);
  }

  dropShield() {
    if (!this.shieldUp) return;
    this.shieldUp = false;
    if (this.built?.shield) this.built.shield.visible = false;
    if (this.shieldMesh) this.shieldMesh.visible = false;
    this.shieldHp = 0;
    // A droideka's own generator cycles back up; an elite's bubble does not.
    // Bringing it back would make the one clean pass that broke it worth
    // nothing, and the whole counter-play is that the pass is worth something.
    this.deployTimer = this.mod === 'shielded' ? Infinity : 4.5;
    audio.explosion(this.position, 0.4);
    this.world.particles?.sparkBurst(this.aimPoint(_v1), null, 30, { speed: 12, color: 0x88ffcc });
  }

  die(point, source, kind) {
    if (this.dead) return;
    this.dead = true;
    this.dying = 0;
    this.world.onEnemyKilled?.(this, source, kind);

    // Retire the hum with the body. dispose() only runs 40s later, when the
    // corpse is cleaned up, and retract() merely fades the gain — so a cleared
    // wave of twelve duellists carried twelve full oscillator stacks and twelve
    // HRTF panners into the next wave. That is what overloads the audio thread.
    if (this.hum) {
      const h = this.hum; this.hum = null;
      h.retract();
      setTimeout(() => { try { h.dispose(); } catch {} }, 400);
    }
    // The elite fittings go with the body: a corpse is not shielded, does not
    // lead, and — for exactly UNSTABLE.fuse seconds — is still a bomb.
    if (this.shieldMesh) { this.shieldUp = false; this.shieldMesh.visible = false; }
    if (this.rallyRing) this.rallyRing.visible = false;
    if (this.offSaber) {
      this.offSaber.retract();
      setTimeout(() => this.offSaber && this.offSaber.setVisible(false), 900);
    }
    if (this.mod === 'unstable' && !this._detonated) {
      this.fuse = UNSTABLE.fuse;
      audio.tone({ freq: 700, freqEnd: 2600, dur: UNSTABLE.fuse, gain: 0.12, type: 'square', pos: this.position });
      this.world.notifyFloating?.(this.aimPoint(_v3), 'UNSTABLE', '#ff8a40');
    }
    if (this.telegraphArc) this.telegraphArc.hide();
    if (this.cloak) { this.cloak.dispose(); this.cloak = null; }
    if (this.skirt) { this.skirt.dispose(); this.skirt = null; }
    if (this.saber) {
      // the blade falls with them, then goes out
      this.saber.retract();
      setTimeout(() => this.saber && this.saber.setVisible(false), 900);
    }
    if (this.actor && !this.actor.ragdolled) {
      _v1.copy(this.velocity).multiplyScalar(0.6);
      if (point && source) {
        _v2.subVectors(this.position, source.position ?? point).setY(0.4).normalize().multiplyScalar(2.2);
        _v1.add(_v2);
      }
      this.actor.goRagdoll(_v1, _v3.set((rng() - .5) * 6, (rng() - .5) * 4, (rng() - .5) * 6));
    }
    if (this.group) {
      this.world.particles?.explosion(this.aimPoint(_v1), 0.9);
      audio.explosion(this.position, 0.8);
      this.world.spawnDebrisGroup(this.group, this.position.clone(), _v2.set(0, 3, 0), 0.9);
      this.group = null;
    }
    if (!this.bodyRemoved) { this.world.physics.remove(this.body); this.bodyRemoved = true; }
    audio.thud(this.position, 1);
  }

  /* ── update ──────────────────────────────────────────────────────── */

  /* ── elites ──────────────────────────────────────────────────────── */

  /**
   * Everything a modifier has to do every frame, in one place.
   *
   * Runs for the living and the dead alike, because a fuse burns on a corpse
   * and a bubble has to be taken off one.
   */
  _updateElite(dt, ctx) {
    if (this.shieldMesh) {
      if (this.dead || !this.shieldUp) this.shieldMesh.visible = false;
      else {
        this.shieldMesh.visible = true;
        this.shieldMesh.position.copy(this.shieldCentre(_v5));
        const u = this.shieldMat.uniforms;
        u.uTime.value += dt;
        u.uPower.value = damp(u.uPower.value, clamp(this.shieldHp / this.shieldMax, 0, 1) * 0.9, 4, dt);
      }
    }
    if (this.rallyRing) {
      const live = !this.dead && !this.toppled;
      this.rallyRing.visible = live;
      if (live) {
        const gy = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : this.position.y;
        this.rallyRing.position.set(this.position.x, gy + 0.06, this.position.z);
        this.rallyRing.material.opacity = 0.20 + Math.sin(ctx.time * 2.4) * 0.06;
      }
      if (this.beacon) this.beacon.scale.setScalar(live ? 1 + Math.sin(ctx.time * 5) * 0.14 : 0.001);
    }
    // A LEADER IS A MULTIPLIER, AND IT SHOWS YOU EXACTLY WHOM IT MULTIPLIES.
    // The ring above is drawn at RALLY.radius, so the set of bodies inside it
    // is the set of bodies getting the buff — no guessing, and one obvious
    // target if you would rather not fight the buffed version of the wave.
    if (this.mod === 'leader' && !this.dead && !this.toppled) {
      const r2 = RALLY.radius * RALLY.radius;
      for (const other of ctx.enemies) {
        if (other === this || other.dead) continue;
        if (other.position.distanceToSquared(this.position) > r2) continue;
        other.rallyTimer = RALLY.refresh;
      }
    }
    if (this.fuse > 0) {
      this.fuse -= dt;
      if (this.coreMesh) {
        const k = clamp(1 - this.fuse / UNSTABLE.fuse, 0, 1);
        this.coreMesh.scale.setScalar(1 + k * 2.6);
        this.coreMesh.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(k * 26));
      }
      if (this.fuse <= 0) this._detonate();
    }
  }

  /**
   * The unstable core going off — after a fuse, never on the frame of death.
   *
   * The delay is the whole fairness argument: the core has been pulsing on its
   * chest since it walked in, it screams for 0.85 s once it dies, and only then
   * does it take the ground it is standing on. Long enough to walk out of,
   * short enough that you cannot ignore where you killed it. It hurts EVERYONE
   * inside the radius, which makes a bomb droid something you can aim.
   */
  _detonate() {
    this.fuse = 0;
    if (this._detonated) return;
    this._detonated = true;
    // The corpse's own centre if it has fallen, its torso if it has not — and
    // never a bone name this chassis might not have, which is what aimPoint's
    // fallback chain is for.
    const point = (this.actor?.ragdolled ? this.actor.centre(_v1) : this.aimPoint(_v1)).clone();
    this.world.particles?.explosion(point, 1.6);
    this.world.onExplosion?.(point, 1.4);
    audio.explosion(point, 1.3);
    this.world.engine?.flash(0.09);
    if (this.coreMesh) this.coreMesh.visible = false;

    const R = UNSTABLE.radius;
    const hurt = (t) => {
      if (!t || t === this) return;
      const pos = t.position;
      if (!pos) return;
      const d = pos.distanceTo(point);
      if (d > R) return;
      const k = 1 - d / R;
      _v2.subVectors(pos, point).setY(0.55).normalize().multiplyScalar(UNSTABLE.impulse * k);
      if (t.applyKnockback) t.applyKnockback(_v2.clone(), UNSTABLE.damage * k, this, false);
      else {
        t.damage?.(UNSTABLE.damage * k, point, this, 'explosion');
        t.velocity?.add(_v2);
        t.camera?.addShake(0.5 * k);
      }
    };
    for (const p of (this.world.players || [])) hurt(p);
    for (const e of (this.world.enemies || [])) if (!e.dead) hurt(e);
  }

  update(dt, ctx) {
    this._updateElite(dt, ctx);
    if (this.rallyTimer > 0) this.rallyTimer = Math.max(0, this.rallyTimer - dt);
    if (this.dead) {
      this.dying += dt;
      if (this.actor) this.actor.update(dt);
      if (this.saber && this.actor?.ragdolled) {
        const hand = this.actor.bodies.get('handR') || this.actor.bodies.get('foreR');
        if (hand) this.saber.setHiltPose(hand.position, hand.quaternion);
        this.saber.update(dt, ctx.time, this.velocity);
      }
      return this.dying < 40;
    }

    this.stateTime += dt;
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    this.yankT = Math.max(0, this.yankT - dt);
    if (this.compelled) {
      this.compelled.t -= dt;
      // It ends when the clock runs out, when the victim dies (there is nothing
      // left to be turned against), or when the compelled unit dies itself.
      if (this.compelled.t <= 0 || this.compelled.target?.dead || this.dead) this.compelled = null;
    }
    if (this.actor) this.actor.update(dt);

    // level of detail: distant enemies skip the expensive solves
    const camDist = ctx.camera.position.distanceTo(this.position);
    const lod = camDist > 62 ? 2 : camDist > 30 ? 1 : 0;
    if (lod !== this.lod) { this.lod = lod; this._applyLod(lod); }

    if (this.netDriven) {
      // a client's copy: the host owns where this thing is, we own how it looks
      if (this.netTarget) {
        _v1.subVectors(this.netTarget, this.position);
        this.velocity.copy(_v1).multiplyScalar(dt > 0 ? Math.min(1 / dt, 18) : 0);
        dampVec(this.position, this.netTarget, 14, dt);
      }
      let d = (this.netFacing ?? this.facing) - this.facing;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.facing += d * Math.min(1, dt * 10);
      this.target = ctx.pickTarget(this);
      if (this.target) this.toTarget = _v2.subVectors(this.target.position, this.position).setY(0).normalize().clone();
      this._syncBody();
      this._pose(dt, ctx);
      return true;
    }

    this._think(dt, ctx);
    this._move(dt, ctx);
    this._pose(dt, ctx);
    return true;
  }

  _think(dt, ctx) {
    const A = this.A;
    // A compelled unit's target REPLACES the world's pick. `_shoot`, the cover
    // logic and the melee brain all read `this.target`, so one substitution
    // here turns the whole unit rather than only its trigger finger.
    const target = this.target = this.compelled?.target ?? ctx.pickTarget(this);
    if (!target) { this.wish = null; return; }

    _v1.subVectors(target.position, this.position);
    const dist = _v1.length();
    this.distToTarget = dist;
    _v1.y = 0;
    if (_v1.lengthSq() > 1e-6) _v1.normalize();
    this.toTarget = _v1.clone();

    if (this.gripped) { this.wish = null; return; }
    if (this.stunTimer > 0 || this.toppled) {
      this.wish = null;
      // A beaten guard has to TRAVEL while the body is reeling. The brain is
      // otherwise frozen for the length of the stun, so the blade would sit
      // exactly where it was parried and only fly wide afterwards — the
      // reaction would play late, after the window it is advertising has half
      // gone. Only the stagger phase runs here; a stunned duellist still
      // cannot think, aim or attack.
      if (this.duel?.staggered && !this.toppled) this.duel.update(dt, ctx, dist);
      return;
    }
    if (A.inert) { this.wish = null; return; }
    if (A.custom === 'remote') { this._remoteBrain(dt, ctx, dist); return; }

    const [near, far] = A.preferred;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeTimer = 1.1 + rng() * 2.2; this.strafeDir = rng() < 0.5 ? 1 : -1; }

    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x).multiplyScalar(this.strafeDir);
    const wish = _v3.set(0, 0, 0);

    // Giving ground is a BAND, not a threshold. The old form was
    //     dist < near  ->  wish = -toTarget
    // which flipped the wish through 180 degrees on the single frame the player
    // crossed `near`, pointed it exactly back down the line they came in on, and
    // ran it at full forward speed. Three separate tells, and together they read
    // as the enemy being shoved rather than choosing to retreat.
    //
    // Now the circling wish and the yielding wish are blended over the inner
    // half of the preferred band, so the enemy eases out of holding its line;
    // and because the lateral term survives the blend, ground is given at an
    // angle the way a real fighter backs off, not straight away from the camera.
    const yieldAmt = smoothstep(near, near * 0.55, dist);
    if (dist > far) wish.copy(this.toTarget);
    else {
      wish.copy(side).addScaledVector(this.toTarget, A.melee ? 0.35 : 0.08);
      if (yieldAmt > 0) wish.addScaledVector(this.toTarget, -yieldAmt * 1.35);
    }

    // spread out — a horde that clumps looks like a bug
    for (const other of ctx.enemies) {
      if (other === this || other.dead) continue;
      _v4.subVectors(this.position, other.position);
      const d2 = _v4.lengthSq();
      const want = (this.radius + other.radius) * 2.4;
      if (d2 > want * want || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      wish.addScaledVector(_v4.multiplyScalar(1 / d), (1 - d / want) * 1.5);
    }
    if (wish.lengthSq() > 1) wish.normalize();
    this.wish = wish.clone();

    if (A.melee) this._meleeBrain(dt, ctx, dist);
    else this._rangedBrain(dt, ctx, dist);
  }

  _rangedBrain(dt, ctx, dist) {
    if (this.disarmed || this.blinded) return;
    const A = this.A;
    const diff = this.world.difficulty;

    if (A.shield) {
      this.deployTimer = Math.max(0, this.deployTimer - dt);
      const wantShield = dist < 22 && this.deployTimer <= 0 && this.shieldHp > 0;
      if (wantShield && !this.shieldUp && this.stateTime > 1.2) {
        this.shieldUp = true;
        this.built.shield.visible = true;
        this.shieldHp = this.shieldMax;
        audio.tone({ freq: 220, freqEnd: 700, dur: 0.5, gain: 0.16, type: 'sine', pos: this.position });
      }
    }

    this.attackTimer -= dt;
    // A rallied shooter reloads faster; the leader's ring is what tells you so.
    const rally = this.rallyTimer > 0 ? RALLY.rate : 1;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._shoot(ctx);
        this.burstLeft--;
        this.burstTimer = (A.burstGap ?? 0.12) * rally;
      }
      return;
    }
    if (this.attackTimer <= 0 && dist < (A.preferred[1] + 12) && this._hasLineOfSight(ctx)) {
      if (A.telegraph) {
        if (this.aimCharge <= 0) {
          this.aimCharge = A.telegraph;
          this._beginTelegraph(ctx);
        }
        this.aimCharge -= dt;
        if (this.aimCharge <= 0) {
          this._endTelegraph();
          this.burstLeft = A.burst ?? 1;
          this.burstTimer = 0;
          this.attackTimer = rally * A.fireRate * (0.75 + rng() * 0.5) / (diff ? diff.enemyAggression * (diff.fireRate ?? 1) : 1);
        }
      } else {
        this.burstLeft = A.burst ?? 1;
        this.burstTimer = 0;
        this.attackTimer = rally * A.fireRate * (0.7 + rng() * 0.6) / (diff ? diff.enemyAggression * (diff.fireRate ?? 1) : 1);
      }
    }
  }

  _remoteBrain(dt, ctx, dist) {
    // circle the student at a polite distance and fire slowly
    this.orbitPhase += dt * 0.55;
    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x);
    const want = _v3.copy(side).multiplyScalar(Math.sin(this.orbitPhase) > 0 ? 1 : -1);
    if (dist > this.A.preferred[1]) want.add(this.toTarget);
    else if (dist < this.A.preferred[0]) want.sub(this.toTarget);
    this.wish = want.normalize().clone();

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = (this.trainingFireRate ?? this.A.fireRate) * (0.8 + rng() * 0.4);
      this._shoot(ctx);
    }
  }

  _beginTelegraph(ctx) {
    if (!this.laser) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2);
      this.laser = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xff3020, transparent: true, opacity: 0.6, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.world.scene.add(this.laser);
    }
    this.laser.visible = true;
    audio.tone({ freq: 1400, freqEnd: 2200, dur: 0.9, gain: 0.07, type: 'sine', pos: this.position });
  }
  _endTelegraph() { if (this.laser) this.laser.visible = false; }

  _hasLineOfSight(ctx) {
    if (!this.target) return false;
    const from = this._muzzleWorld(_v5);
    _v6.subVectors(this.target.chest ?? this.target.position, from);
    const d = _v6.length();
    _v6.multiplyScalar(1 / d);
    const hit = ctx.physics.raycast(from, _v6, d - 0.6, (b) => b.static || b.layer === LAYER.PROP);
    if (hit) return false;
    if (ctx.terrain) {
      const t = ctx.terrain.raycast(from, _v6, d - 0.6, _v1, _v2);
      if (t !== null) return false;
    }
    return true;
  }

  _muzzleWorld(out) {
    if (this.built?.muzzles?.length) {
      // a remote fires from whichever emitter is facing the student
      const m = this.built.muzzles[(this._armToggle = ((this._armToggle || 0) + 1) % this.built.muzzles.length)];
      return m.getWorldPosition(out);
    }
    if (this.weapon && this.weapon.userData.muzzle) {
      return out.copy(this.weapon.userData.muzzle).applyMatrix4(this.weapon.matrixWorld);
    }
    if (this.built?.arms?.length) {
      const a = this.built.arms[(this._armToggle = 1 - (this._armToggle || 0))];
      return a.muzzle.getWorldPosition(out);
    }
    if (this.built?.cannons?.length) {
      const c = this.built.cannons[(this._armToggle = 1 - (this._armToggle || 0))];
      return c.muzzle.getWorldPosition(out);
    }
    if (this.rig) {
      const f = this.rig.get('foreR');
      if (f) return this.rig.tipPos('foreR', out);
    }
    return out.copy(this.position).setY(this.chestY);
  }

  _shoot(ctx) {
    const A = this.A;
    const target = this.target;
    if (!target) return;
    const from = this._muzzleWorld(_v1).clone();
    const aimAt = _v2.copy(target.chest ?? target.position);
    /* SHOOTING ITSELF is aimed at the chest like everything else, but the
     * muzzle is already past it — a rifle held at the shoulder has its barrel
     * end a good half metre in FRONT of the ribs — so `aimAt - from` points
     * backwards and the shot goes over the droid's shoulder into the sky. The
     * bolt has to start behind the chest and travel through it. Dropping the
     * muzzle to the hip and aiming up under the chin is the pose a unit turning
     * its own weapon on itself actually takes, and it is the only special case
     * compulsion needs anywhere in this file. */
    if (target === this) {
      from.set(this.position.x, this.position.y + 0.55 * (A.scale ?? 1), this.position.z)
        .addScaledVector(_v5.set(Math.sin(this.facing), 0, Math.cos(this.facing)), 0.26 * (A.scale ?? 1));
      aimAt.set(this.position.x, this.position.y + 1.35 * (A.scale ?? 1), this.position.z);
    }

    const diff = this.world.difficulty;
    const acc = diff ? diff.enemyAccuracy : 0.7;
    // lead the shot, then throw it off by however good this difficulty is
    const speed = 88 * (diff ? diff.boltSpeed : 1) * (A.big ? 1.2 : 1);
    const tof = from.distanceTo(aimAt) / speed;
    if (target.velocity) aimAt.addScaledVector(target.velocity, tof * acc);

    _v3.subVectors(aimAt, from).normalize();
    const spread = (A.spread ?? 0.06) * (2 - acc);
    _v3.x += (rng() - 0.5) * spread; _v3.y += (rng() - 0.5) * spread * 0.7; _v3.z += (rng() - 0.5) * spread;
    _v3.normalize();

    ctx.bolts.fire(from, _v3, {
      speed: this.trainingBoltSpeed ?? speed,
      damage: this.attackDamage * (this.rallyTimer > 0 ? RALLY.damage : 1),
      color: A.boltColor ?? BOLT_COLORS.red,
      owner: this, team: this.team, big: !!A.big,
      length: A.big ? 2.4 : 1.15, radius: A.big ? 0.1 : 0.05,
      /* The flag the hit test needs. A bolt is normally sorted by TEAM, and a
       * compelled droid is still on the droids' team — it has not changed
       * sides, it has been made to point the wrong way — so without this its
       * shots pass harmlessly through the ally it is aiming at and the whole
       * ability is a droid doing an impression. `turned` is read beside
       * `deflected` in World._boltHitTest, which is the existing seam for "a
       * bolt that may hurt the side that fired it". */
      turned: !!this.compelled,
    });
    audio.blaster(from, !!A.big);
    this.world.particles?.plasma.spawn(from, _v4.set(0, 0, 0), {
      life: 0.07, size: A.big ? 0.9 : 0.42, drag: 1, gravity: 0, color: A.boltColor ?? 0xff3020, alpha: 1 });
    this.muzzleFlash = 0.06;
  }

  _meleeBrain(dt, ctx, dist) {
    if (!this.saber) { this._beastBrain(dt, ctx, dist); return; }
    if (this.lock) { this.wish = null; return; }   // a blade lock pins both fighters
    if (this.trainingSpeed) this.duel.timeScale = this.trainingSpeed;
    // The leader's aura reaches the duel brain as tempo, which is what the form
    // actually spends: shorter guards, shorter recoveries, the same attacks.
    if (this.rallyTimer > 0) {
      this._duelBase = this._duelBase ?? this.duel.timeScale;
      this.duel.timeScale = this._duelBase / RALLY.rate;
    } else if (this._duelBase !== undefined) {
      this.duel.timeScale = this._duelBase;
      this._duelBase = undefined;
    }
    this.duel.update(dt, ctx, dist);
    // a lunging attack actually carries the duellist forward
    if (this.duel.lungeSpeed > 0.01 && this.toTarget) {
      this.velocity.addScaledVector(this.toTarget, this.duel.lungeSpeed * dt * 9);
    }
    if (this.offSaber && !this.offDisarmed) this._offhandStrike(dt, ctx);
  }

  /**
   * The second blade's own hit, and why it is here rather than in World.
   *
   * World tests exactly one blade per duellist — `e.saber.prevTip → e.saber.tip`
   * against the player's capsule — and it owns the clash resolution for that
   * blade. A second weapon that only LOOKED like a weapon would be the same lie
   * the boon table has a note about, so the off blade swings for itself.
   *
   * It is deliberately the FOLLOW-UP, not a duplicate: it lands in the back half
   * of the strike, once per attack, for a fraction of the damage. So the
   * telegraph you already read still tells you when to move, and the answer to a
   * dual-wielder is to be gone by the second beat rather than to parry twice.
   */
  _offhandStrike(dt, ctx) {
    const duel = this.duel;
    const phase = duel.phase;
    if (phase !== 'strike') { this._offPhase = phase; return; }
    if (this._offPhase !== 'strike') { this._offPhase = 'strike'; this._offSwung = false; }
    if (this._offSwung) return;
    // the back half of the arc — the main blade has already gone through
    if (duel.timer > (duel._strikeLen ?? 0.2) * 0.5) return;
    this._offSwung = true;

    const t = this.target;
    if (!t || !t.position) return;
    const reach = 1.15 * (this.A.scale ?? 1) + 0.9;
    _v1.copy(t.chest ?? t.position);
    if (this.offHand.distanceTo(_v1) > reach) return;
    if (t.invuln > 0) return;
    t.damage?.(this.attackDamage * 0.55 * duel.damageScale, _v1.clone(), this, 'saber');
    _v2.subVectors(t.position, this.position).setY(0.25).normalize().multiplyScalar(4.5);
    t.velocity?.add(_v2);
    t.camera?.addShake(0.16);
    audio.swing(18, this.offSaber.base);
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The main blade's hit                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * WHY THE DUELLIST'S OWN BLADE TESTS ITSELF.
   *
   * World had a test for this blade and it was written correctly — the tip's
   * sweep against the player's spine capsule, gated on the strike phase. It
   * never fired, because the blade was 180° out (see guardQuat in Duel.js) and
   * the tip's closest approach over thirty seconds of duelling was 2.18 m.
   *
   * Once the blade points the right way that test starts landing, and its two
   * remaining weaknesses become the difference between "sometimes hits" and
   * "cuts you the way you cut it":
   *
   *  1. IT IS A TIP TEST. Only `prevTip → tip` is checked, so the middle of a
   *     1.12 m blade passes through a body for free. The player's blade is a
   *     swept QUAD against capsules — the whole edge cuts — and this is the
   *     same test in the same spirit: the blade is sampled along its length as
   *     well as through the frame.
   *  2. IT TAKES A SINGLE SAMPLE PER FRAME. A strike phase is 0.11–0.19 s and
   *     the tip covers ~2 m in it; one sample per frame at 30 fps steps 0.7 m
   *     at a time and tunnels straight through a 0.8 m-wide body.
   *
   * Contact of steel on steel outranks contact of steel on flesh, exactly as
   * World's own ordering says, so this stands down whenever the player's blade
   * is on this one — the clash a few lines later in the frame is the answer,
   * and a hit here would be a blade cutting through a block.
   *
   * Runs from _poseSaber, AFTER the blade has been posed and updated, so the
   * prev→cur sweep it reads is this frame's. Enemies update before
   * World._resolveBlades, and a hit here interrupts the strike phase, so the
   * older tip test cannot fire a second time on the same swing.
   */
  _saberStrike(ctx) {
    const duel = this.duel;
    if (!duel || !this.saber || this.saber.ignition < 0.6 || this.lock) return false;
    if (duel.phase !== 'strike') { this._strikePhase = duel.phase; return false; }
    // once per strike, and the phase edge is what defines "once"
    if (this._strikePhase !== 'strike') { this._strikePhase = 'strike'; this._struck = false; }
    if (this._struck) return false;

    const t = this.target;
    if (!t || !t.position || t.alive === false || !t.damage) return false;
    if (t.invuln > 0) return false;
    // steel on steel wins: leave it to the clash
    if (t.saber && bladesTouching(t.saber, this.saber)) return false;

    // The body, as one capsule from the shins to the crown. `crouch` shortens
    // it because a crouching player really is a smaller target.
    const crouch = clamp(t.crouch ?? 0, 0, 1);
    const p0 = _v1.copy(t.position).setY(t.position.y + 0.35);
    const p1 = _v2.copy(t.position).setY(t.position.y + lerp(1.72, 1.26, crouch));
    const rad = (t.radius ?? 0.34) + BLADE_BITE;

    // Enough samples that the fastest tip in the game cannot step past a body:
    // the tip covers up to ~0.9 m in a 30 fps frame and the body is 0.8 m wide.
    const travel = this.saber.tip.distanceTo(this.saber.prevTip);
    const steps = clamp(Math.ceil(travel / 0.16), 1, 8);
    let bestD = Infinity;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      _v3.lerpVectors(this.saber.prevBase, this.saber.base, k);
      _v4.lerpVectors(this.saber.prevTip, this.saber.tip, k);
      const res = segmentSegment(_v3, _v4, p0, p1, _v5, _v6);
      // `_hit` rather than a clone per sample: this runs eight times a frame
      // for every duellist in a strike, and a Vector3 per sample is garbage
      // for the eight frames in a row that a swing lasts.
      if (res.distSq < bestD) { bestD = res.distSq; _hit.copy(_v5); }
      if (res.distSq <= rad * rad) break;
    }
    if (bestD > rad * rad) return false;

    // one clone, once a hit is real: it is handed to damage(), the particles
    // and the floating label, all of which may hold on to it
    const best = _hit.clone();
    this._struck = true;
    const dmg = this.attackDamage * duel.damageScale * (this.rallyTimer > 0 ? RALLY.damage : 1);
    t.damage(dmg, best, this, 'saber');

    // shoved off the line, not merely dinged
    _v3.subVectors(t.position, this.position).setY(0.3);
    if (_v3.lengthSq() < 1e-6) _v3.set(0, 0.3, 0);
    _v3.normalize().multiplyScalar(6);
    t.velocity?.add(_v3);
    t.camera?.addShake(0.28);
    this.world.particles?.cutFlare(best, null, this.saber.color.getHex(), 20);
    this.world.notifyFloating?.(best, duel.attack?.label?.toUpperCase() ?? 'HIT', '#ff8a6a');
    audio.cut(best, false);
    this.world.addHitstop?.(0.05);
    this.saber.strain(0.7);

    // …and it presses. See DuelBrain.followUp.
    duel.followUp();
    return true;
  }

  /**
   * A boss should not be one move repeated. The acklay works through three
   * phases as it loses health — stalking, then sweeping, then enraged — and
   * every heavy attack leaves it winded, which is the window to take a leg.
   * Three legs and it goes down, physically, because it has three legs left.
   */
  _beastBrain(dt, ctx, dist) {
    const A = this.A;
    const hpFrac = clamp(this.hp / this.maxHp, 0, 1);
    const phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      this.speed = A.speed * (1 + (phase - 1) * 0.22);
      if (phase > 1) {
        this.world.notify?.(`${A.label.toUpperCase()} — PHASE ${phase}`, phase === 3 ? 'it has stopped being careful' : 'it is angry now');
        audio.explosion(this.position, 1.2);
        this.stun(0.6);
        this.world.particles?.sandPuff(this.position.clone(), 3.2,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
        this.world.engine?.flash(0.1);
      }
    }

    // being hurt fast enough winds it — the only safe time to go for a leg
    this.windTimer = Math.max(0, (this.windTimer || 0) - dt);
    this.recentDamage = Math.max(0, (this.recentDamage || 0) - dt * this.maxHp * 0.12);
    if (this.recentDamage > this.maxHp * 0.14 && this.windTimer <= 0 && this.state !== 'winded') {
      this.recentDamage = 0;
      this.state = 'winded';
      this.stateTime = 0;
      this.windTimer = 7;
      this.world.notifyFloating?.(this.aimPoint(_v1), 'WINDED', '#ffd88a');
      audio.explosion(this.position, 0.7);
    }
    if (this.state === 'winded') {
      this.wish = null;
      if (this.stateTime > 2.4) { this.state = 'approach'; }
      return;
    }

    this.attackTimer -= dt;
    if (dist < A.preferred[1] + 2.5 && this.attackTimer <= 0 && this.state === 'approach') {
      const roll = rng();
      const canSweep = phase >= 2;
      const canCharge = phase >= 3;
      this.state = canCharge && roll < 0.34 ? 'charge'
                 : canSweep && roll < 0.66 ? 'sweep'
                 : 'lunge';
      this.attackTimer = lerp(2.4, 1.15, (phase - 1) / 2) + rng() * 1.1;
      this.stateTime = 0;
      this._swiped = false;
      this.lungeDir = this.toTarget.clone();
      audio.explosion(this.position, this.state === 'charge' ? 0.9 : 0.5);
      if (this.state === 'charge') this.world.notifyFloating?.(this.aimPoint(_v1), 'CHARGE', '#ff6a52');
    }

    const hitTarget = (radius, dmg, lift) => {
      if (this._swiped) return;
      this._swiped = true;
      const t = this.target;
      if (t && t.position.distanceTo(this.position) < radius) {
        _v1.subVectors(t.position, this.position).setY(lift).normalize().multiplyScalar(16);
        t.damage?.(dmg, this.position, this);
        t.velocity?.add(_v1);
        t.camera?.addShake(0.7);
      }
      this.world.particles?.sandPuff(this.position.clone().addScaledVector(this.toTarget, 3), 2.4,
        this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
    };

    if (this.state === 'lunge') {
      if (this.stateTime < 0.5) this.velocity.addScaledVector(this.lungeDir, 42 * dt);
      else if (this.stateTime < 0.85) hitTarget(5.4 * A.scale * 0.6, this.attackDamage, 0.5);
      else { this.state = 'approach'; this._swiped = false; }
    } else if (this.state === 'sweep') {
      // a wide claw arc — step aside rather than back
      if (this.stateTime > 0.55 && this.stateTime < 0.95) hitTarget(6.6 * A.scale * 0.6, this.attackDamage * 0.85, 0.9);
      else if (this.stateTime >= 1.15) { this.state = 'approach'; this._swiped = false; }
    } else if (this.state === 'charge') {
      if (this.stateTime < 0.65) this.wish = null;                    // the wind-up
      else if (this.stateTime < 1.9) {
        this.velocity.addScaledVector(this.lungeDir, 30 * dt);
        hitTarget(4.6 * A.scale * 0.6, this.attackDamage * 1.3, 0.8);
        if (rng() < 0.4) this.world.particles?.sandPuff(this.position.clone(), 1.4,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
      } else { this.state = 'approach'; this._swiped = false; }
    }
  }

  /* ── motion ──────────────────────────────────────────────────────── */

  _move(dt, ctx) {
    const terrain = ctx.terrain;

    if (this.gripped && this.liftTarget) {
      /**
       * HELD BODIES HANG. Note 48.
       *
       * This used to be the whole of it: damp the position toward the hold
       * point and let the animator go on walking. A droid lifted off the floor
       * slid through the air in a jogging pose, which is the least cinematic
       * possible reading of the most cinematic thing in the source material.
       *
       * A body held off the ground is ragdolled and SUSPENDED by the chest —
       * see Ragdoll.suspend — so the arms fall, the head lolls, the legs trail
       * and swinging the mouse swings a real joint solve. `position` follows
       * the ragdoll's own centre rather than driving it, so everything that
       * asks where this enemy is still gets an answer.
       *
       * Anything without an actor to ragdoll (a stub, a droideka mid-transform)
       * falls back to the old rigid path rather than losing the grip.
       */
      if (this.actor && !this.dead) {
        if (!this.actor.ragdolled) this.actor.goRagdoll(this.velocity, null);
        if (this.actor.suspend?.(this.liftTarget, dt)) {
          this.actor.centre(this.position);
          this.velocity.set(0, 0, 0);
          this.grounded = false;
          this._syncBody();
          return;
        }
      }
      dampVec(this.position, this.liftTarget, 8, dt);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      this._syncBody();
      return;
    }
    if (this.toppled) { this._syncBody(); return; }

    const canMove = this.stunTimer <= 0 && this.knockTimer <= 0 && !this.gripped;
    if (canMove && this.wish) {
      const speed = this.speed * (this.legsLost ? 0.45 : 1) * (this.rallyTimer > 0 ? RALLY.speed : 1);
      _v1.copy(this.wish).multiplyScalar(speed);
      // Nobody backpedals as fast as they run. Only the component pointing AWAY
      // from the target is scaled, so a sidestep keeps its full pace and only
      // the retreat slows — which is both what a body does and what makes a
      // retreat legible instead of looking like the enemy is on rails.
      if (this.toTarget) limitBackpedal(_v1, this.toTarget);
      // Reversing is slower to build than pressing forward: pushing off the back
      // foot cannot produce the acceleration that pushing off the front one does,
      // and an instant reversal is the single biggest "unnatural" tell there is.
      const rate = (this.velocity.x * _v1.x + this.velocity.z * _v1.z) < 0 ? 5.0 : 8;
      this.velocity.x = damp(this.velocity.x, _v1.x, rate, dt);
      this.velocity.z = damp(this.velocity.z, _v1.z, rate, dt);
    } else if (this.knockTimer <= 0) {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    }

    if (this.A.float) {
      // hover: hold a height above the ground with a slow bob
      const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
      this.hoverPhase += dt * 1.7;
      const want = gh + this.A.float + Math.sin(this.hoverPhase) * 0.16;
      this.velocity.y = damp(this.velocity.y, (want - this.position.y) * 4.5, 8, dt);
      this.position.addScaledVector(this.velocity, dt);
      this.grounded = false;
      this._syncBody();
      return;
    }

    if (!this.grounded) this.velocity.y -= 24 * dt;
    this.position.addScaledVector(this.velocity, dt);

    // THE SAME GROUND THE PLAYER STANDS ON. This sampled the terrain heightfield
    // alone, and the box loop below has no top-landing branch at all — its
    // resolution is `_v4.y = 0`, horizontal, always. So an enemy could not stand
    // on a rock, a crate or a piece of its own ruined architecture: it sank
    // through and stood on the sand underneath, or hopped on the spot the way
    // the player's did. See src/physics/Support.js.
    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    const support = supportHeight(terrain, ctx.physics?.staticBoxes, null,
      this.position.x, this.position.z, this.position.y, this.radius, STEP_UP);
    this.supportY = support;
    if (this.position.y < support) this.position.y = support;
    if (this.position.y <= support + GROUND_SNAP && this.velocity.y <= 0.1) {
      if (this.velocity.y < -9) {
        ctx.particles?.sandPuff(this.position.clone(), 0.8, support, this.world.groundColor);
        audio.thud(this.position, 0.6);
        if (this.velocity.y < -20 && !this.A.boss) this.damage(clamp(-this.velocity.y - 20, 0, 60), this.position, null, 'fall');
      }
      this.position.y = support;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (this.position.y > support + 0.06) this.grounded = false;

    // stay inside the arena
    if (terrain && !terrain.inBounds(this.position.x, this.position.z, 4)) {
      const h = terrain.half - 4;
      this.position.x = clamp(this.position.x, -h, h);
      this.position.z = clamp(this.position.z, -h, h);
    }

    // static geometry
    for (const box of ctx.physics.staticBoxes) {
      if (box.disabled) continue;
      _v1.set(this.position.x, this.position.y + 0.9, this.position.z);
      if (_v1.distanceToSquared(box.center) > (box.radius + 1.6) ** 2) continue;
      _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
      const h = box.halfExtents;
      _v3.set(clamp(_v2.x, -h.x, h.x), clamp(_v2.y, -h.y, h.y), clamp(_v2.z, -h.z, h.z));
      _v4.subVectors(_v2, _v3);
      const d2 = _v4.lengthSq();
      const r = this.radius;
      if (d2 > r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      _v4.multiplyScalar(1 / d).applyQuaternion(box.quat);
      // an upward face is floor, and the support query above owns floors
      if (_v4.y > 0.5) continue;
      _v4.y = 0;
      if (_v4.lengthSq() < 1e-6) continue;
      _v4.normalize();
      this.position.addScaledVector(_v4, r - d);
    }

    // face the target while fighting, face travel otherwise
    let want = this.facing;
    if (this.toTarget && this.stunTimer <= 0) want = Math.atan2(this.toTarget.x, this.toTarget.z);
    else if (this.velocity.lengthSq() > 1) want = Math.atan2(this.velocity.x, this.velocity.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.facing += d * Math.min(1, dt * (this.A.big ? 3.2 : 8));

    this._syncBody();
  }

  _syncBody() {
    if (this.bodyRemoved) return;
    this.body.setTransform(_v1.set(this.position.x, this.position.y + (this.A.big ? 1.4 : 0.9), this.position.z), null);
  }

  /* ── pose ────────────────────────────────────────────────────────── */

  _pose(dt, ctx) {
    const A = this.A;
    if (this.actor?.ragdolled) return;

    if (this.animator) {
      // the feet stand where the body stands — see src/physics/Support.js
      const groundAt = (x, z) => supportHeight(ctx.terrain, ctx.physics?.staticBoxes, null,
        x, z, this.position.y, this.radius, STEP_UP);
      this.animator.setFacing(this.facing);
      this.animator.update(dt, {
        position: this.position, facing: this.facing, velocity: this.velocity,
        grounded: this.grounded, groundAt, crouch: 0,
        accelForward: clamp(this.velocity.length() / 5, 0, 1),
      });
      this._poseArms(dt, ctx);
    } else if (this.rig) {
      this._poseWalker(dt, ctx);
    } else if (this.group && A.custom === 'remote') {
      this.group.position.copy(this.position);
      this.group.rotation.y += dt * 1.2;
      if (this.built.halo) this.built.halo.intensity = 1.1 + Math.sin(ctx.time * 6 + this.hoverPhase) * 0.5;
    } else if (this.group) {
      this._poseDroideka(dt, ctx);
    }

    if (this.laser && this.laser.visible && this.target) {
      const from = this._muzzleWorld(_v1);
      _v2.subVectors(this.target.chest ?? this.target.position, from);
      const len = _v2.length();
      this.laser.position.copy(from);
      this.laser.quaternion.setFromUnitVectors(_v3.set(0, 0, 1), _v2.normalize());
      this.laser.scale.set(1, 1, len);
    }
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
  }

  _poseArms(dt, ctx) {
    const rig = this.rig;
    if (!rig || this.lod > 1) return;
    const chest = rig.worldPos('chest', _v1);
    const fwd = _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v3.set(fwd.z, 0, -fwd.x);
    const S = this.A.scale;

    if (this.saber) {
      this._poseSaber(dt, ctx, chest, fwd, right);
      return;
    }
    if (this.disarmed || !this.weapon) {
      this.animator?.swingArms(dt, this.velocity.length(), 1);
      return;
    }
    // both hands to the weapon, weapon pointed at the target
    const aim = this.target ? _v4.copy(this.target.chest ?? this.target.position).sub(chest).normalize()
                            : _v4.copy(fwd);
    const holdR = _v5.copy(chest).addScaledVector(aim, 0.34 * S).addScaledVector(right, 0.16 * S).addScaledVector(UP, -0.13 * S);
    const poleR = _v6.copy(chest).addScaledVector(right, 0.8).addScaledVector(UP, -0.7);
    rig.solveIK('armR', 'foreR', holdR, poleR);
    if (!this.A.custom) {
      const holdL = _v5.copy(chest).addScaledVector(aim, 0.5 * S).addScaledVector(right, -0.02 * S).addScaledVector(UP, -0.1 * S);
      const poleL = _v6.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7);
      rig.solveIK('armL', 'foreL', holdL, poleL);
    }
    // point the weapon down the aim line
    const hand = rig.get('handR');
    if (hand && hand.obj.parent) {
      aimY(_v5.copy(aim).lerp(UP, 0.42).normalize(), null, _q1);
      hand.obj.parent.getWorldQuaternion(_q2);
      hand.obj.quaternion.copy(_q2.invert()).multiply(_q1);
    }
    rig.updateMatrices();
  }

  _poseSaber(dt, ctx, chest, fwd, right) {
    const rig = this.rig;
    const S = this.A.scale;

    // the duel brain owns where the guard wants to be
    const guard = this.duel.guardDir;
    const fast = this.duel.phase === 'strike';

    // Guard space is −Z forward; `facing` is a +Z-forward yaw. guardQuat owns
    // the half turn between them — see the note on it in Duel.js. With a bare
    // yaw here the hands sat BEHIND the body and the blade swung backwards,
    // which is why no duellist had ever hit anything.
    guardQuat(this.facing, this.duel.spin, _q1);
    const dirWorld = _v5.copy(guard).applyQuaternion(_q1).normalize();
    const reach = 0.34 + (this.duel.attack?.reach ?? 0);
    const handTarget = _v6.copy(chest).addScaledVector(dirWorld, reach * S).addScaledVector(UP, -0.08 * S);
    const guardPoint = _v1.copy(chest).addScaledVector(dirWorld, (reach + 0.61) * S);

    if (!this._saberHandInit) { this.saberHand.copy(handTarget); this._saberHandInit = true; }
    dampVec(this.saberHand, handTarget, fast ? 30 : 12, dt);

    _v2.subVectors(guardPoint, this.saberHand).normalize();
    aimY(_v2, null, _q2);
    this.saberQuat.slerp(_q2, clamp(dt * (fast ? 26 : 10), 0, 1));

    this.saber.setHiltPose(this.saberHand, this.saberQuat);
    this.saber.update(dt, ctx.time, this.velocity);
    // HERE, and not in _meleeBrain, because the blade's prev→cur sweep only
    // exists once it has been posed: think() runs before pose(), so a hit test
    // up there would be reading where the blade was LAST frame.
    this._saberStrike(ctx);
    // set() issues nine AudioParam automations and move() three more, per hum,
    // per frame. Twenty duellists at 60fps is 14,400 events/second queued onto
    // parameter timelines — so distant blades update at a coarser cadence.
    if (this.hum && (this.lod === 0 || (this._humTick = (this._humTick | 0) + 1) % 4 === 0)) {
      this.hum.set(this.saber.swingSpeed, this.saber.contactStrain);
      this.hum.move(this.saber.pointAt(0.5, _v3));
    }

    // arms follow the hilt, exactly like the player's do
    const poleR = _v3.copy(chest).addScaledVector(right, 0.8 * S).addScaledVector(UP, -0.75 * S);
    rig.solveIK('armR', 'foreR', this.saberHand, poleR);
    const poleL = _v3.copy(chest).addScaledVector(right, -0.7 * S).addScaledVector(UP, -0.8 * S);
    if (this.offSaber) this._poseOffhand(dt, ctx, poleL, fast, S);
    else rig.solveIK('armL', 'foreL', _v2.copy(this.saberHand).addScaledVector(right, -0.06 * S).addScaledVector(UP, -0.06 * S), poleL);
    rig.updateMatrices();

    // close duellists get simulated robes; distant ones do not need them
    if (this.cloak) {
      if (this.lod > 1) { this.cloak.setVisible(false); this.skirt?.setVisible(false); }
      else {
        _v3.copy(this.velocity).multiplyScalar(-0.8).setY(0);
        // skirt first: the cape's proxy is the skirt's own particles
        if (this.skirt) {
          this.skirt.setVisible(true);
          this.skirt.update(dt, this.skirt.refreshColliders(), _v3);
        }
        this.cloak.setVisible(true);
        this.cloak.update(dt, this.cloak.refreshColliders(), _v3);
      }
    }
  }

  /**
   * The off hand, when it is holding a blade rather than steadying one.
   *
   * The guard direction is MIRRORED across the fighter's centre line and lagged
   * behind the main blade, which is what makes two blades read as two blades: a
   * pair that tracked the same target with the same damping would look like one
   * weapon drawn twice. The lag is also honest about the timing — the off blade
   * really does arrive after the main one, which is what `_offhandStrike` hits
   * on.
   */
  _poseOffhand(dt, ctx, poleL, fast, S) {
    const rig = this.rig;
    const arm = rig.get('armL');
    if (this.offDisarmed || !arm || arm.severed) {
      rig.solveIK('armL', 'foreL', _o1.copy(this.saberHand).addScaledVector(UP, -0.06 * S), poleL);
      return;
    }
    // Its OWN temporaries, re-read from the rig. The chest and right-axis
    // vectors _poseSaber hands round are module scratch that the pole targets
    // above have already written over by the time this runs; borrowing them
    // would make the second blade's guard a function of whatever happened to be
    // left in _v1.
    const chest = rig.worldPos('chest', _o1);
    const fwd = _o2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _o3.set(fwd.z, 0, -fwd.x);
    guardQuat(this.facing, this.duel.spin, _oq);
    const dir = _o4.copy(this.duel.guardDir).applyQuaternion(_oq).normalize();

    // mirror the guard about the body's own right axis, then drop it a little:
    // a second blade is carried low, ready to come up under the first.
    const mirrored = dir.addScaledVector(right, -2 * dir.dot(right)).addScaledVector(UP, -0.28).normalize();
    const reach = 0.32 + (this.duel.attack?.reach ?? 0) * 0.6;
    const handTarget = _o5.copy(chest).addScaledVector(mirrored, reach * S).addScaledVector(UP, -0.14 * S);
    const guardPoint = _o6.copy(chest).addScaledVector(mirrored, (reach + 0.58) * S);

    if (!this._offHandInit) { this.offHand.copy(handTarget); this._offHandInit = true; }
    dampVec(this.offHand, handTarget, fast ? 18 : 8, dt);
    guardPoint.sub(this.offHand).normalize();
    aimY(guardPoint, null, _oq);
    this.offQuat.slerp(_oq, clamp(dt * (fast ? 16 : 7), 0, 1));
    this.offSaber.setHiltPose(this.offHand, this.offQuat);
    this.offSaber.update(dt, ctx.time, this.velocity);
    rig.solveIK('armL', 'foreL', this.offHand, poleL);
  }

  _poseWalker(dt, ctx) {
    const rig = this.rig;
    const S = this.A.scale;
    const nLegs = this.A.custom === 'beast' ? 6 : 4;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / (1.1 * S), 0.1, 2.4)) % 1;

    const bodyH = (this.A.custom === 'beast' ? 1.5 : 1.6) * S;
    const hips = rig.hipsBone.obj;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    hips.position.set(this.position.x, Math.max(this.position.y, gh) + bodyH + Math.sin(this.walkPhase * TAU * 2) * 0.05 * S, this.position.z);
    hips.quaternion.setFromAxisAngle(UP, this.facing);
    rig.updateMatrices();

    if (this.lod > 1) return;
    const fwd = _v1.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v2.set(fwd.z, 0, -fwd.x);

    for (let i = 0; i < nLegs; i++) {
      const femur = rig.get(`femur${i}`);
      if (!femur || femur.severed) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const ph = (this.walkPhase + (i % 2) * 0.5 + row * 0.18) % 1;
      const stance = ph < 0.5;
      const t = stance ? 0 : (ph - 0.5) * 2;

      const zOff = (row - (nLegs / 2 - 1) / 2) * 0.62 * S;
      const foot = _v3.copy(this.position)
        .addScaledVector(right, side * 1.35 * S)
        .addScaledVector(fwd, zOff + (stance ? -0.3 : lerp(-0.3, 0.7, t)) * S);
      foot.y = (ctx.terrain ? ctx.terrain.height(foot.x, foot.z) : 0) + (stance ? 0 : Math.sin(t * Math.PI) * 0.42 * S);

      const knee = _v4.copy(foot).addScaledVector(right, side * 1.4 * S).addScaledVector(UP, 1.5 * S);
      rig.solveIK(`femur${i}`, `tibia${i}`, foot, knee);
      const tarsus = rig.get(`tarsus${i}`);
      if (tarsus) {
        _v5.copy(fwd).multiplyScalar(0.3).setY(-0.95).normalize();
        rig.aimBoneWorld(`tarsus${i}`, _v5, null);
      }
    }
    // head tracks the target — a yaw/pitch, since the chassis geometry is
    // authored facing +Z rather than along the bone axis
    const headBone = rig.get('head');
    if (this.target && headBone && !headBone.severed) {
      _v3.subVectors(this.target.chest ?? this.target.position, rig.worldPos('head', _v4));
      const localYaw = Math.atan2(_v3.x, _v3.z) - this.facing - Math.PI;
      headBone.obj.quaternion.copy(headBone.restQuat).multiply(
        _q1.setFromEuler(new THREE.Euler(clamp(Math.atan2(_v3.y, Math.hypot(_v3.x, _v3.z)), -0.5, 0.5),
          clamp(((localYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.7, 0.7), 0, 'YXZ')));
    }
    rig.updateMatrices();
  }

  _poseDroideka(dt, ctx) {
    if (!this.group) return;
    const b = this.built;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    this.group.position.set(this.position.x, Math.max(this.position.y, gh), this.position.z);
    this.group.quaternion.setFromAxisAngle(UP, this.facing);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / 1.2, 0.05, 3)) % 1;
    b.legs.forEach((leg, i) => {
      if (leg.gone) return;
      const ph = (this.walkPhase + i / 3) % 1;
      leg.leg.rotation.x = Math.sin(ph * TAU) * 0.22;
      leg.lower.rotation.x = -0.2 + Math.cos(ph * TAU) * 0.2;
    });
    if (this.target) {
      _v1.subVectors(this.target.chest ?? this.target.position, b.headG.getWorldPosition(_v2));
      const pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
      b.headG.rotation.x = clamp(-pitch, -0.5, 0.5);
      for (const arm of b.arms) arm.arm.rotation.x = clamp(-pitch * 0.6, -0.5, 0.5);
    }
    if (b.shield.visible) {
      b.shieldMat.uniforms.uTime.value += dt;
      const u = b.shieldMat.uniforms.uPower;
      u.value = damp(u.value, clamp(this.shieldHp / this.shieldMax, 0, 1) * 0.85, 4, dt);
    }
  }

  dispose() {
    // Modifier fittings first. The bone-parented ones (plates, core, standard)
    // are freed by the rig's own traverse — they are children of bones — so
    // only the scene-parented ones and the cloned materials are ours to undo.
    if (this.shieldMesh) {
      this.world.scene.remove(this.shieldMesh);
      this.shieldMesh.geometry.dispose();
      this.shieldMat?.dispose();
      this.shieldMesh = null;
    }
    if (this.rallyRing) {
      this.world.scene.remove(this.rallyRing);
      this.rallyRing.geometry.dispose();
      this.rallyRing.material.dispose();
      this.rallyRing = null;
    }
    if (this.offSaber) { this.offSaber.dispose(); this.offSaber = null; }
    if (this._modMaterials) { for (const m of this._modMaterials) m.dispose(); this._modMaterials = null; }
    if (this.saber) this.saber.dispose();
    if (this.hum) this.hum.dispose();
    if (this.cloak) this.cloak.dispose();
    if (this.skirt) this.skirt.dispose();
    if (this.telegraphArc) this.telegraphArc.dispose();
    if (this.laser) { this.world.scene.remove(this.laser); this.laser.geometry.dispose(); this.laser.material.dispose(); }
    if (this.actor) this.actor.dispose();
    else if (this.rig) { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    if (this.group) this.world.scene.remove(this.group);
    if (!this.bodyRemoved) this.world.physics.remove(this.body);
  }
}

/** How lethal losing each bone is. */
const VITAL = {
  head: 0.95, neck: 1.0, chest: 1.0, spine: 1.0, hips: 1.0, body: 1.0,
  clavL: 0.5, clavR: 0.5, armL: 0.35, armR: 0.35, foreL: 0.22, foreR: 0.22,
  handL: 0.1, handR: 0.1, thighL: 0.55, thighR: 0.55, shinL: 0.3, shinR: 0.3,
  footL: 0.12, footR: 0.12,
};
