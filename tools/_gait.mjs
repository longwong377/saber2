/**
 * SABER — what the swing foot actually does, in the units the complaint was
 * made in.
 *
 *   node --import ./tools/register.mjs tools/_gait.mjs
 *
 * The gait note in src/game/Rig.js says the swing foot descends at 3.4 m/s at a
 * walk and 7.0 at a sprint where a real foot lands at well under 0.5, and that
 * the pelvis is chained to it through the reach clamp. That was written from a
 * one-off measurement. This turns it into an instrument, because the fix has to
 * move four numbers at once and a change that helps one while quietly wrecking
 * another is the failure mode this project keeps hitting.
 *
 * WHAT IS MEASURED, and why each one is here:
 *
 *   land      the foot's downward speed on the LAST frame before it plants.
 *             This is the number that reads as a stamp. A real foot arrives at
 *             well under 0.5 m/s; the mean descent over the swing is NOT this
 *             number and improving the mean does not fix the stamp.
 *   fall      the worst downward speed anywhere in the swing. High here with a
 *             low `land` is a foot that drops and then catches itself, which
 *             looks like a marionette.
 *   lift      peak height of the sole point above its own path. A walk that
 *             lifts 135mm is a march.
 *   clear     the LOWEST the sole point gets between 15% and 85% of the swing,
 *             as a fraction of peak lift. Whatever the arc is reshaped into,
 *             the foot still has to miss the floor.
 *   pelvis    worst single-frame travel of the drawn hip joint, in mm. 88mm in
 *             one frame at a sprint is the hitch the player feels.
 *   bind      fraction of frames on which the reach clamp actually lowered the
 *             pelvis below what the gait asked for. Above a jog this was 99.8%,
 *             i.e. the clamp WAS the pelvis height and the bob was decorative.
 *   knee      stance-knee flexion at its straightest, degrees. This is the
 *             posture bill: anything that buys a softer landing by dropping the
 *             hips pays for it here, and past ~30° it reads as a crouch.
 *   ext       peak leg extension as a fraction of leg length. solveIK clamps at
 *             0.985 and past that the drawn foot leaves the point it is
 *             standing on, which is worse than either artefact above.
 */
import '../tools/dom-shim.mjs';
import * as THREE from 'three';
import { Rig, humanoidSkeleton, BipedAnimator } from '../src/game/Rig.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const D = 180 / Math.PI;

/** Walk a figure in a straight line and record what its feet and hips did. */
export function march(speed, { seconds = 10, dt = 1 / 60, hipHeight = 0.95 } = {}) {
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight });
  const pos = V3(0, 0, 0);
  anim.setFacing(0);

  const prevY = [null, null];
  const prevT = [1, 1];
  let land = 0, fall = 0, lift = 0, clearFrac = 1;
  let pelvis = 0, prevHip = null, bind = 0, frames = 0, worstAt = '';
  let knee = 180, ext = 0, over = 0, plant = 0;
  // one swing's worth of samples, kept so the arc can be printed
  const arc = [];

  const N = Math.round(seconds / dt);
  for (let i = 0; i < N; i++) {
    pos.z += speed * dt;
    anim.update(dt, {
      position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0,
    });
    anim.swingArms(dt, speed, 1);
    rig.updateMatrices();

    const settled = i * dt > 3;
    const hipY = rig.worldPos('hips', V3()).y;

    if (settled) {
      frames++;
      if (prevHip != null && Math.abs(hipY - prevHip) > pelvis) {
        pelvis = Math.abs(hipY - prevHip);
        worstAt = anim.feet.map((f) => (f.grounded ? 'stance'
          : `swing t=${f.t.toFixed(2)} lift=${(f.lift * 1000).toFixed(0)}`)).join(' | ')
          + `  intent ${(anim.hipIntent * 1000).toFixed(0)} limit ${(anim.reachLimit * 1000).toFixed(0)} foot ${anim.bindFoot}`;
      }
      // The clamp bound iff the drawn pelvis sits below what bob alone asked
      // for. anim.pelvis.y is the applied offset from the neutral stance point,
      // and `bob + landDip` is the intent, so their difference is the clamp.
      if (anim.reachLimit < anim.hipIntent - 1e-4) bind++;
    }
    prevHip = hipY;

    for (let k = 0; k < 2; k++) {
      const f = anim.feet[k];
      const y = f.pos.y;
      if (settled && prevY[k] != null && !f.grounded) {
        const v = (prevY[k] - y) / dt;                 // positive = descending
        fall = Math.max(fall, v);
        lift = Math.max(lift, f.lift);
        if (f.t > 0.15 && f.t < 0.88) clearFrac = Math.min(clearFrac, f.lift);
        if (k === 0) arc.push({ t: f.t, lift: f.lift, v });
      }
      // the frame the foot arrives: prevT < 1 and now grounded
      if (settled && prevY[k] != null && f.grounded && prevT[k] < 1) {
        land = Math.max(land, (prevY[k] - y) / dt);
      }
      prevY[k] = y;
      prevT[k] = f.grounded ? 1 : f.t;

      // HOW FAR AHEAD OF THE HIP THE FOOT ACTUALLY GETS, against the plant
      // offset the stride budget sized itself for. The gap between these two
      // is SWING_OVER, measured instead of derived.
      if (settled && !f.grounded) {
        const hip = rig.worldPos('hips', V3());
        over = Math.max(over, f.pos.z + Math.sin(f.yaw) * 0 - hip.z);
      }

      // posture, sampled only while this leg is carrying weight
      if (settled && f.grounded) {
        const hip = rig.worldPos(k ? 'thighR' : 'thighL', V3());
        const kn = rig.tipPos(k ? 'thighR' : 'thighL', V3());
        const an = rig.tipPos(k ? 'shinR' : 'shinL', V3());
        const a = hip.distanceTo(kn), b = kn.distanceTo(an), c = hip.distanceTo(an);
        knee = Math.min(knee, 180 - Math.acos(
          Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b)))) * D);
        ext = Math.max(ext, c / (a + b));
      }
    }
  }
  return {
    speed, land, fall, lift, clearFrac,
    pelvis: pelvis * 1000, bind: bind / Math.max(frames, 1), knee, ext, arc, worstAt,
    freq: anim.freq, span: anim.span, spanMax: anim.spanMax, over,
    plant: anim._gFront * anim.span, front: anim._gFront,
    reach: anim.spanMax > 0 ? anim.span / anim.spanMax : 0,
    dur: (1 - anim.duty) / anim.freq, duty: anim.duty,
  };
}

const SPEEDS = [1.6, 3.0, 4.6, 7.4];

export function sweep(opts) {
  return SPEEDS.map((v) => march(v, opts));
}

export function table(rows) {
  const L = ['  v      land    fall    lift   clear   pelvis   bind    knee    ext'
    + '     span/max  reach   Hz   swing'];
  for (const r of rows) {
    L.push(`  ${r.speed.toFixed(1)}  ${r.land.toFixed(2).padStart(6)}  `
      + `${r.fall.toFixed(2).padStart(6)}  ${(r.lift * 1000).toFixed(0).padStart(4)}mm  `
      + `${(r.clearFrac * 1000).toFixed(0).padStart(4)}mm `
      + `${r.pelvis.toFixed(1).padStart(6)}mm  ${(r.bind * 100).toFixed(1).padStart(5)}%  `
      + `${r.knee.toFixed(1).padStart(5)}°  ${(r.ext * 100).toFixed(1)}%`
      + `   ${(r.span * 100).toFixed(0).padStart(3)}/${(r.spanMax * 100).toFixed(0)}cm`
      + `  ${(r.reach * 100).toFixed(0).padStart(3)}%  ${r.freq.toFixed(2)}  `
      + `${(r.dur * 1000).toFixed(0)}ms`);
  }
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('units: land/fall m/s, lift mm, clear = lowest lift over t 0.15-0.88, mm\n');
  const rows = sweep();
  console.log(table(rows));
  console.log('\nthe frame each worst pelvis step happened on:');
  for (const r of rows) console.log(`  ${r.speed.toFixed(1)}  ${r.pelvis.toFixed(1)}mm   ${r.worstAt}`);
  console.log('\nswing overshoot: how far ahead of the hip the foot gets vs where it plants');
  for (const r of rows) console.log(`  ${r.speed.toFixed(1)}  peak ${(r.over*1000).toFixed(0)}mm  plant ${(r.plant*1000).toFixed(0)}mm`
    + `  over ${((r.over-r.plant)*1000).toFixed(0)}mm = ${((r.over-r.plant)/Math.max(r.span,1e-9)).toFixed(3)} span`);
}
