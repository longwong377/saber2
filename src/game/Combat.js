/**
 * SABER — combat resolution.
 *
 * Deflections are graded, never rolled. Cuts are geometric, never tagged. The
 * difference between a bolt scattering off your guard and a bolt going back
 * through the chest of the droid that fired it is entirely a question of how
 * fast the blade was moving, where along its length the bolt landed, and
 * whether you were looking at anything worth sending it to.
 */

import * as THREE from 'three';
import { segmentSegment } from '../physics/Physics.js';
import { clamp, lerp, smoothstep } from '../engine/MathUtil.js';
import { segmentCapsule } from './Bolts.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export const GRADE = { BLOCK: 0, DEFLECT: 1, RETURN: 2, PERFECT: 3 };
export const GRADE_NAME = ['BLOCK', 'DEFLECT', 'RETURN', 'PERFECT RETURN'];

export const DIFFICULTY = {
  padawan: {
    name: 'Padawan', blurb: 'The blade is forgiving. Assist guides your guard.',
    assist: 0.55, enemyAccuracy: 0.42, enemyAggression: 0.55, damageTaken: 0.55,
    deflectWindow: 1.6, boltSpeed: 0.72, chamberWindow: 0.22, staminaDrain: 0.7,
  },
  knight: {
    name: 'Knight', blurb: 'A fair fight. Light assist, honest bolts.',
    assist: 0.26, enemyAccuracy: 0.62, enemyAggression: 0.78, damageTaken: 0.85,
    deflectWindow: 1.25, boltSpeed: 0.88, chamberWindow: 0.17, staminaDrain: 0.9,
  },
  master: {
    name: 'Master', blurb: 'No hand on your wrist. They shoot to kill.',
    assist: 0.07, enemyAccuracy: 0.8, enemyAggression: 1.0, damageTaken: 1.15,
    deflectWindow: 1.0, boltSpeed: 1.0, chamberWindow: 0.14, staminaDrain: 1.0,
  },
  grandmaster: {
    name: 'Grandmaster', blurb: 'Zero assist. Every bolt is yours to answer.',
    assist: 0, enemyAccuracy: 0.94, enemyAggression: 1.25, damageTaken: 1.5,
    deflectWindow: 0.86, boltSpeed: 1.15, chamberWindow: 0.11, staminaDrain: 1.15,
  },
};

/** Material toughness — how much blade speed·second it takes to part it. */
export const TOUGHNESS = {
  flesh: 0.9, cloth: 0.5, plastoid: 1.5, droid: 2.0, armour: 4.5,
  heavy: 14, durasteel: 42, blastdoor: 110, unbreakable: Infinity,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Deflection                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * @param bolt      the incoming bolt
 * @param saber     the blade it met
 * @param hit       { bladeT, point } from intersectBladeSweep
 * @param ctx       { aimOrigin, aimDir, candidates, flow, difficulty, skillBias }
 * @returns { grade, dir, damageMul, target }
 */
export function gradeDeflection(bolt, saber, hit, ctx) {
  const bladeT = clamp(hit.bladeT, 0, 1);
  const bladeSpeed = saber.speedAt(bladeT);
  const boltDir = _v1.copy(bolt.vel).normalize();

  // surface normal: radial from the blade axis out toward the bolt
  _v2.subVectors(hit.point, saber.base);
  const along = _v2.dot(saber.axis);
  _v3.copy(saber.base).addScaledVector(saber.axis, along);
  _v4.subVectors(hit.point, _v3);
  if (_v4.lengthSq() < 1e-8) _v4.copy(boltDir).negate().projectOnPlane(saber.axis);
  if (_v4.lengthSq() < 1e-8) _v4.set(1, 0, 0);
  _v4.normalize();
  if (_v4.dot(boltDir) > 0) _v4.negate();     // normal must face the bolt

  // blade velocity at the contact point
  _v5.lerpVectors(saber.baseVelocity, saber.tipVelocity, bladeT);
  const closing = -_v5.dot(boltDir);           // >0 means driving into the bolt

  let grade = GRADE.BLOCK;
  if (bladeSpeed > 3.2 || closing > 1.6) grade = GRADE.DEFLECT;

  // Return: a fast tip, and somewhere worth sending it
  let target = null;
  const tipZone = bladeT > 0.42;
  if (grade === GRADE.DEFLECT && bladeSpeed > 7.5 && tipZone && ctx.candidates) {
    target = pickReturnTarget(ctx.aimOrigin, ctx.aimDir, ctx.candidates, ctx.returnCone ?? 0.42);
    if (target) grade = GRADE.RETURN;
  }
  if (grade === GRADE.RETURN && bladeSpeed > 15 && closing > 5 && bladeT > 0.55) grade = GRADE.PERFECT;

  // outgoing direction
  const out = new THREE.Vector3();
  if (grade >= GRADE.RETURN && target) {
    out.subVectors(target.point, hit.point).normalize();
    // a tiny inaccuracy that Flow removes entirely
    const jitter = (1 - clamp(ctx.flow ?? 0, 0, 1)) * (grade === GRADE.PERFECT ? 0.008 : 0.028);
    out.x += (Math.random() - 0.5) * jitter;
    out.y += (Math.random() - 0.5) * jitter;
    out.z += (Math.random() - 0.5) * jitter;
    out.normalize();
  } else {
    // mirror about the blade surface, then carry some of the blade's motion
    out.copy(boltDir).reflect(_v4);
    if (grade === GRADE.BLOCK) {
      const scatter = 0.55;
      out.x += (Math.random() - 0.5) * scatter;
      out.y += (Math.random() - 0.5) * scatter + 0.12;
      out.z += (Math.random() - 0.5) * scatter;
    } else {
      out.addScaledVector(_v5, 0.018);
    }
    out.normalize();
  }

  const damageMul = grade === GRADE.PERFECT ? 2.5 : grade === GRADE.RETURN ? 1.5 : 1.0;
  return { grade, dir: out, damageMul, target, bladeSpeed, normal: _v4.clone(), bladeT };
}

/** Nearest valid enemy inside the aim cone. */
export function pickReturnTarget(origin, aimDir, candidates, cone = 0.42) {
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!c || c.dead) continue;
    const p = c.aimPoint ? c.aimPoint(_v6) : (c.position ? _v6.copy(c.position) : null);
    if (!p) continue;
    _v1.subVectors(p, origin);
    const dist = _v1.length();
    if (dist < 1.2 || dist > 90) continue;
    _v1.multiplyScalar(1 / dist);
    const dot = _v1.dot(aimDir);
    if (dot < 1 - cone) continue;
    const score = dot * 2 + (1 - clamp(dist / 90, 0, 1));
    if (score > bestScore) { bestScore = score; best = { entity: c, point: p.clone(), dist }; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade vs bodies                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

export class BladeContactSolver {
  constructor() {
    this.progress = new Map();      // "actorId:bone" → accumulated cut work
    this.cooldown = new Map();
    this.time = 0;
    this.activeCuts = [];           // for slag VFX on heavy materials
  }

  /**
   * @param saber        the blade doing the cutting
   * @param targets      [{ id, capsules:[{name,p0,p1,r,toughness,vital}], onCut, onGraze, team }]
   * @param opts.power   damage multiplier from boons
   * @returns array of events
   */
  solve(saber, targets, dt, opts = {}) {
    this.time += dt;
    const events = [];
    this.activeCuts.length = 0;
    if (saber.ignition < 0.7) return events;

    const SLICES = 4;
    for (const target of targets) {
      if (!target || target.dead) continue;
      const caps = target.capsules;
      if (!caps || !caps.length) continue;

      for (const cap of caps) {
        const key = target.id + ':' + cap.name;
        const cd = this.cooldown.get(key) || 0;
        if (cd > this.time) continue;

        // sweep the blade across the frame so a fast slash cannot skip a limb
        let hit = null, bestSlice = 0;
        for (let i = 0; i <= SLICES; i++) {
          const k = i / SLICES;
          _v1.lerpVectors(saber.prevBase, saber.base, k);
          _v2.lerpVectors(saber.prevTip, saber.tip, k);
          const h = segmentCapsule(_v1, _v2, cap.p0, cap.p1, cap.r);
          if (h) { hit = h; bestSlice = k; break; }
        }
        if (!hit) continue;

        const bladeT = clamp(hit.s, 0, 1);
        const speed = saber.speedAt(bladeT) * (opts.power ?? 1);
        const tough = cap.toughness ?? TOUGHNESS.flesh;

        if (tough === Infinity) {
          events.push({ type: 'clang', target, cap, point: hit.point.clone(), bladeT });
          saber.strain(0.8);
          this.cooldown.set(key, this.time + 0.12);
          continue;
        }

        // work accumulates: light materials part instantly, heavy ones take a
        // deliberate push — a blast door is just a very patient limb
        const work = (this.progress.get(key) || 0) + speed * dt * 2.4;
        if (work < tough) {
          this.progress.set(key, work);
          saber.strain(clamp(0.25 + tough / 60, 0, 1));
          this.activeCuts.push({ point: hit.point.clone(), progress: work / tough, cap, target });
          events.push({ type: 'grind', target, cap, point: hit.point.clone(), bladeT, progress: work / tough, speed });
          continue;
        }
        this.progress.delete(key);

        // where along the limb did the blade cross?
        const cutT = clamp(hit.t, 0.06, 0.94);
        _v3.subVectors(cap.p1, cap.p0);
        const cutPoint = _v4.copy(cap.p0).addScaledVector(_v3, cutT);

        // the cut plane is the plane the blade swept
        const dirImpulse = _v5.lerpVectors(saber.baseVelocity, saber.tipVelocity, bladeT).clone();
        events.push({
          type: 'cut', target, cap, bone: cap.name, cutT, bladeT, speed,
          point: cutPoint.clone(), impulse: dirImpulse, normal: saber.sweepNormal.clone(),
        });
        saber.strain(0.5);
        this.cooldown.set(key, this.time + 0.14);
      }
    }
    return events;
  }

  clearTarget(id) {
    for (const k of [...this.progress.keys()]) if (k.startsWith(id + ':')) this.progress.delete(k);
    for (const k of [...this.cooldown.keys()]) if (k.startsWith(id + ':')) this.cooldown.delete(k);
  }

  reset() { this.progress.clear(); this.cooldown.clear(); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade vs blade                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * @returns null | { type:'chamber'|'parry'|'bind'|'clash', point, winner, power }
 */
export function resolveBladeClash(a, b, ctxA, ctxB) {
  if (a.ignition < 0.6 || b.ignition < 0.6) return null;
  const res = segmentSegment(a.base, a.tip, b.base, b.tip, _a, _b);
  const r = 0.10;
  if (res.distSq > r * r) return null;

  const point = _a.clone().lerp(_b, 0.5);
  const ta = clamp(res.s, 0, 1), tb = clamp(res.t, 0, 1);

  _v1.lerpVectors(a.baseVelocity, a.tipVelocity, ta);
  _v2.lerpVectors(b.baseVelocity, b.tipVelocity, tb);
  const sa = _v1.length(), sb = _v2.length();

  // are the blades driving into each other, or resting together?
  _v3.subVectors(_v1, _v2);
  const closing = _v3.length();

  let type;
  if (closing < 2.6 && sa < 4 && sb < 4) type = 'bind';
  else if (sa > 6 && sb > 6) type = 'clash';
  else type = 'parry';

  // chamber: the defender's blade is moving directly against the attacker's arc
  const attacker = sa > sb ? 'a' : 'b';
  const atkV = attacker === 'a' ? _v1 : _v2;
  const defV = attacker === 'a' ? _v2 : _v1;
  const atkSpeed = attacker === 'a' ? sa : sb;
  const defSpeed = attacker === 'a' ? sb : sa;
  let chambered = null;
  if (atkSpeed > 5.5 && defSpeed > 4.0) {
    const align = -_v4.copy(defV).normalize().dot(_v5.copy(atkV).normalize());
    if (align > 0.72) { type = 'chamber'; chambered = attacker === 'a' ? 'b' : 'a'; }
  }

  const power = clamp((sa + sb) / 28, 0.2, 1.6);
  const winner = type === 'chamber' ? chambered : (sa > sb ? 'a' : 'b');
  return { type, point, winner, power, sa, sb, ta, tb, closing };
}
