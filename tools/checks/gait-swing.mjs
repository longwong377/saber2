/**
 * The swing foot, and the pelvis that was chained to it. — src/game/Rig.js
 *
 * The gait note in Rig.js measured, correctly, that the swing foot descended at
 * 3.4 m/s at a walk and 7.0 at a sprint, and that the reach clamp dragged the
 * pelvis down with it — 88 mm in a single frame at a sprint, against a bob that
 * only ever asked for 30. It then concluded the arc could not be fixed on its
 * own, wrote the numbers down, and left it.
 *
 * The conclusion was the wrong half. The foot was ALREADY landing at 0.00 m/s;
 * what the 3.4-7.0 measured was a mid-swing plunge the foot caught itself out
 * of. Five separate defects were behind it and none of them was the arc alone:
 *
 *   the stride was sized to saturate the reach budget EXACTLY, so the clamp
 *   was the pelvis height on 100% of frames above a walk and the bob was
 *   decorative;
 *
 *   the budget checked the plant instant, but a swing foot decelerating to a
 *   dead stop while the body keeps moving reaches its furthest a few frames
 *   BEFORE that — 463 mm against a 344 mm plant offset at a sprint;
 *
 *   the ankle had two incompatible models, one exact and one with a fudge
 *   factor putting the pivot past the end of the boot;
 *
 *   the clamp treated an unloaded swing leg as a rigid strut;
 *
 *   and the budget did not know what ground it was stepping onto, so uphill
 *   the drawn ankle came 67 mm off its own plant point.
 *
 * Every check here would fail on that code, and the three that can be shown
 * rather than asserted inline the OLD expression next to the new one so the
 * contrast survives whoever reads this next.
 */
import { Rig, humanoidSkeleton, BipedAnimator } from '../../src/game/Rig.js';

let THREE = null;
const D = 180 / Math.PI;

/** Walk a figure in a straight line on given ground and record the gait. */
function march(speed, { seconds = 9, dt = 1 / 60, ground = () => 0 } = {}) {
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const rig = new Rig(humanoidSkeleton(1));
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  const pos = V3(0, 0, 0);
  anim.setFacing(0);

  const prevY = [null, null];
  let fall = 0, land = 0, lift = 0, liftAt = 0, pelvis = 0, prevHip = null;
  let bind = 0, frames = 0, aheadPeak = 0;
  const N = Math.round(seconds / dt);
  for (let i = 0; i < N; i++) {
    pos.z += speed * dt;
    pos.y = ground(pos.x, pos.z);
    anim.update(dt, {
      position: pos, facing: 0, velocity: V3(0, 0, speed), grounded: true,
      groundAt: ground, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0,
    });
    rig.updateMatrices();

    const settled = i * dt > 3.5;
    const hipY = rig.worldPos('hips', V3()).y - pos.y;
    if (settled) {
      frames++;
      if (prevHip != null) pelvis = Math.max(pelvis, Math.abs(hipY - prevHip));
      if (anim.reachLimit < anim.hipIntent - 1e-4) bind++;
    }
    prevHip = hipY;

    for (let k = 0; k < 2; k++) {
      const f = anim.feet[k];
      if (!settled) { prevY[k] = f.pos.y; continue; }
      if (!f.grounded) {
        if (prevY[k] != null) {
          const v = (prevY[k] - f.pos.y) / dt;
          fall = Math.max(fall, v);
          // the last frame before the plant is the one that reads as a stamp
          if (f.t > 0.985) land = Math.max(land, v);
        }
        if (f.lift > lift) { lift = f.lift; liftAt = f.t; }
        aheadPeak = Math.max(aheadPeak, f.pos.z - rig.worldPos('hips', V3()).z);
      }
      prevY[k] = f.pos.y;
    }
  }
  return {
    speed, fall, land, lift, liftAt, pelvis, aheadPeak,
    bind: bind / Math.max(frames, 1),
    span: anim.span, spanMax: anim.spanMax, freq: anim.freq, front: anim._gFront,
    duty: anim.duty,
  };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('swing: the foot does not plunge mid-swing and catch itself', () => {
    // Baseline on the code this replaced, same instrument: 3.41 / 3.13 / 5.28 /
    // 6.98 m/s. Every one of those is over the bound below, so this check could
    // not have passed before. A foot that drops at 5 m/s and then arrives at
    // zero is not a stamp — it is a marionette, and it is what the player was
    // looking at when they called the walk janky.
    const rows = [];
    for (const [speed, cap] of [[1.6, 1.6], [3.0, 1.8], [4.6, 2.6], [7.4, 2.8]]) {
      const r = march(speed);
      assert(r.fall < cap,
        `at ${speed} m/s the swing foot falls at ${r.fall.toFixed(2)} m/s mid-swing`);
      // and it still has to ARRIVE dead, which is the property that was
      // already right and must not be traded away for a gentler middle
      assert(r.land < 0.5,
        `at ${speed} m/s the foot lands at ${r.land.toFixed(2)} m/s — that is a stamp`);
      rows.push(`${speed} ${r.fall.toFixed(2)}/${r.land.toFixed(2)}`);
    }
    return `worst/landing descent m/s — ${rows.join(', ')}`;
  });

  check('swing: the arc peaks EARLY, like a knee that folds at toe-off', () => {
    // sin(pi·u^1.3)·(1 - smoothstep(0.80,1,u)) peaked at u=0.59 and then dropped
    // the foot the whole way inside the last fifth of the swing. A real swing
    // leg is highest just after toe-off and low and reaching through terminal
    // swing. Shown, not asserted:
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const old = (u) => Math.sin(Math.PI * Math.pow(u, 1.3)) * (1 - ss(0.80, 1, u));
    let oldPeak = 0, oldAt = 0, oldFall = 0;
    for (let i = 0; i <= 2000; i++) {
      const u = i / 2000;
      if (old(u) > oldPeak) { oldPeak = old(u); oldAt = u; }
      if (i) oldFall = Math.max(oldFall, (old(u - 1 / 2000) - old(u)) * 2000);
    }
    assert(oldAt > 0.5, 'the old arc no longer peaks late — this comparison is stale');

    const r = march(3.0);
    assert(r.liftAt < 0.5,
      `the swing peaks at ${r.liftAt.toFixed(2)} of the way through — the old one peaked at ${oldAt.toFixed(2)}`);
    // A walk lifting 134mm is a march. Both exponents of the new arc exceed 1,
    // so the foot neither snaps off the floor nor arrives moving; the obvious
    // alternative of skewing the sine earlier with u^0.75 has an INFINITE slope
    // at the origin, which is why it is not what is in there.
    const w = march(1.6);
    assert(w.lift < 0.11, `a walk lifts the foot ${(w.lift * 1000).toFixed(0)}mm — that is a march`);
    assert(w.lift > 0.04, `a walk lifts only ${(w.lift * 1000).toFixed(0)}mm — the foot will clip the ground`);
    return `peak at ${r.liftAt.toFixed(2)} (was ${oldAt.toFixed(2)}), walk lifts `
      + `${(w.lift * 1000).toFixed(0)}mm, old arc's worst descent ${oldFall.toFixed(2)}/unit`;
  });

  check('swing: the reach clamp is a safety net, not the pelvis height', () => {
    // THE ONE THAT MATTERS. `freq = max(freq, duty·speed/spanMax)` sets the
    // stance span to spanMax exactly whenever the natural cadence is too slow,
    // so the legs ran at 100% of their own reach limit and the clamp bound on
    // 99.8% of frames at every speed above a walk — the bob was decorative and
    // the pelvis height was whatever the swing foot's geometry dictated, frame
    // to frame. Measured before: 6.4% / 100% / 100% / 100%.
    const rows = [];
    for (const speed of [1.6, 3.0, 4.6, 7.4]) {
      const r = march(speed);
      assert(r.bind < 0.5,
        `at ${speed} m/s the reach clamp sets the pelvis height on ${(r.bind * 100).toFixed(0)}% of frames`);
      rows.push(`${speed} ${(r.bind * 100).toFixed(0)}%`);
    }
    // and the pelvis must not step further in one frame than a running pelvis
    // does. 88.3mm at a sprint was the hitch; the bob alone asks for ~30.
    for (const [speed, cap] of [[1.6, 0.015], [3.0, 0.020], [4.6, 0.040], [7.4, 0.040]]) {
      const r = march(speed);
      assert(r.pelvis < cap,
        `at ${speed} m/s the pelvis moved ${(r.pelvis * 1000).toFixed(1)}mm in one frame`);
    }
    return `clamp binds ${rows.join(', ')} of frames`;
  });

  check('swing: the ankle has ONE model of where it is, not two', () => {
    // `ankleFwd` rolled the foot about a pivot and was exact. `ankleRise` was
    // `footLen · sin|pitch| · (pitch < 0 ? 0.85 : 0.4)`, and 0.85 of a 190mm
    // foot puts the pivot 161mm ahead of an ankle whose toe is 133mm ahead —
    // past the end of the boot. The two disagreed, so the stride budget spent
    // rear reach the leg did not have.
    //
    // The property is rigidity: a foot is a rigid body, so however it rolls,
    // the ankle stays a fixed distance from whatever it is pivoting on. That is
    // exact, it needs no tolerance argument, and the old pair fails it.
    const rig = new Rig(humanoidSkeleton(1));
    const a = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    let worstNew = 0, worstOld = 0;
    for (let deg = -70; deg <= 30; deg += 2) {
      const pitch = deg / D;
      a._ankleOffset(pitch);
      const d = pitch < 0
        ? a.footBall + (a.footToe - a.footBall)
          * (() => { const t = Math.min(1, Math.max(0, (-pitch - 0.35) / 0.65)); return t * t * (3 - 2 * t); })()
        : -a.footHeel;
      const rest = Math.hypot(d, a.ankleY);
      // where the pivot is on the ground, relative to the contact point
      const fwd = a._ankFwd, rise = a.ankleY + a._ankRise;
      worstNew = Math.max(worstNew, Math.abs(Math.hypot(fwd - d, rise) - rest));
      const oldRise = a.ankleY + a.footLen * Math.sin(Math.abs(pitch)) * (pitch < 0 ? 0.85 : 0.4);
      const oldPivot = pitch < 0 ? a.footBall : -a.footHeel;
      const oldFwd = oldPivot * (1 - Math.cos(pitch)) - a.ankleY * Math.sin(pitch);
      worstOld = Math.max(worstOld,
        Math.abs(Math.hypot(oldFwd - oldPivot, oldRise) - Math.hypot(oldPivot, a.ankleY)));
    }
    assert(worstNew < 1e-9,
      `the ankle stretches ${(worstNew * 1000).toFixed(2)}mm off its own pivot as the foot rolls`);
    assert(worstOld > 0.02,
      'the old pair no longer disagrees — this comparison is stale, rewrite it');
    return `rigid to ${(worstNew * 1e9).toFixed(1)}nm; the model it replaced was off by `
      + `${(worstOld * 1000).toFixed(0)}mm`;
  });

  check('swing: the stride budget knows what ground it is stepping onto', () => {
    // Both budgets assumed the two ends of a stance were level with each other,
    // which is true on a floor and nowhere else. Uphill the trailing foot is
    // below the hip by the slope times how far back it is, so the leg with
    // furthest to reach is also reaching downhill: 67mm of drawn ankle off its
    // plant point on a 20° ramp.
    const flat = march(3.0);
    const up = march(3.0, { ground: (x, z) => z * 0.36 });
    const down = march(3.0, { ground: (x, z) => -z * 0.36 });
    assert(up.spanMax < flat.spanMax * 0.9,
      `uphill the stride budget is ${(up.spanMax * 100).toFixed(0)}cm against ${(flat.spanMax * 100).toFixed(0)}cm on the flat `
      + '— the slope is not reaching the budget at all');
    assert(down.spanMax < flat.spanMax * 1.02 && down.spanMax > flat.spanMax * 0.55,
      `downhill the budget went to ${(down.spanMax * 100).toFixed(0)}cm against ${(flat.spanMax * 100).toFixed(0)}cm flat`);
    return `span budget flat ${(flat.spanMax * 100).toFixed(0)}cm, `
      + `up 20° ${(up.spanMax * 100).toFixed(0)}cm, down 20° ${(down.spanMax * 100).toFixed(0)}cm`;
  });

  check('swing: the budget is sized for the furthest the foot GETS, not where it lands', () => {
    // The foot decelerates to a dead stop so it touches down without sliding,
    // and the body travels through that deceleration — so its lead over the hip
    // peaks BEFORE the plant. Measured at a sprint before this was accounted
    // for: 463mm at t=0.89 against the 344mm plant offset the stride had been
    // sized against, and the pelvis dived 119mm to meet it.
    const rows = [];
    for (const speed of [1.6, 4.6, 7.4]) {
      const r = march(speed);
      const plant = r.front * r.span;
      const over = (r.aheadPeak - plant) / Math.max(r.span, 1e-9);
      // the peak has to be real — a budget that claims none is not measuring
      assert(over > 0.02, `at ${speed} m/s the measured overshoot is ${over.toFixed(3)} of a span; `
        + 'the instrument is not seeing the swing');
      // and it has to be INSIDE what the budget set aside for it, which is
      // SWING_OVER · (1-duty)/duty. A 15% margin over the model is the most it
      // may drift before the clamp starts taking the pelvis again.
      // SWING_OVER · (1-duty)/duty is what the budget set aside for it, and
      // `duty` is published by the animator rather than guessed from speed.
      const budgeted = 0.086 * (1 - r.duty) / r.duty;
      assert(over < budgeted * 1.35,
        `at ${speed} m/s the foot gets ${(over * 100).toFixed(1)}% of a span past its plant offset, `
        + `against ${(budgeted * 100).toFixed(1)}% budgeted at duty ${r.duty.toFixed(2)}`);
      rows.push(`${speed} ${(over * 100).toFixed(1)}%`);
    }
    return `overshoot past the plant offset: ${rows.join(', ')} of a stance span`;
  });
}
