/**
 * SABER — does a retreat look like a person giving ground?
 *
 * The report was "the enemies back away really quickly and awkwardly as you
 * approach them — it's almost unnatural even when you approach them at speed."
 * The retreat itself is wanted; what was wrong was that it ran at full forward
 * speed, pointed straight back down the line the player came in on, and flipped
 * through 180 degrees on the single frame the player crossed the inner
 * preferred range. Three separate tells, none of which would fail a reading.
 */

import * as THREE from 'three';
import { limitBackpedal, ARCHETYPES } from '../../src/game/Enemy.js';
import { smoothstep } from '../../src/engine/MathUtil.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert }) {
  check('retreat: giving ground is slower than taking it', () => {
    const toTarget = V(0, 0, -1);                 // target lies down -Z
    const speed = 4.1;                            // a clone trooper
    const back = limitBackpedal(V(0, 0, speed), toTarget);   // straight retreat
    const fwd = limitBackpedal(V(0, 0, -speed), toTarget);   // straight advance
    const ratio = back.length() / fwd.length();
    assert(Math.abs(fwd.length() - speed) < 1e-6,
      `an advance was slowed to ${fwd.length().toFixed(2)} of ${speed} — only the retreat should be`);
    assert(ratio > 0.3 && ratio < 0.75,
      `backpedal is ${(ratio * 100).toFixed(0)}% of forward speed; a body does roughly half`);
    return `retreat ${back.length().toFixed(2)} m/s vs advance ${fwd.length().toFixed(2)} m/s (${(ratio * 100).toFixed(0)}%)`;
  });

  check('retreat: a sidestep keeps its full pace', () => {
    const toTarget = V(0, 0, -1);
    const speed = 4.1;
    const side = limitBackpedal(V(speed, 0, 0), toTarget);
    assert(Math.abs(side.length() - speed) < 1e-6,
      `a pure sidestep was slowed to ${side.length().toFixed(3)} of ${speed}`);
    // and a diagonal retreat should lose only its away component
    const diag = limitBackpedal(V(3, 0, 3), toTarget);
    assert(Math.abs(diag.x - 3) < 1e-6, `the lateral part of a diagonal retreat moved: ${diag.x.toFixed(3)}`);
    assert(Math.abs(diag.z - 1.5) < 1e-6, `the away part should halve to 1.5, got ${diag.z.toFixed(3)}`);
    return 'lateral untouched, away halved';
  });

  check('retreat: the yield eases in over a band instead of snapping', () => {
    // This mirrors the blend in Enemy._brain: yieldAmt ramps across the inner
    // half of the preferred range rather than switching at a threshold.
    const [near] = ARCHETYPES.trooper.preferred;
    const at = (d) => smoothstep(near, near * 0.55, d);
    assert(at(near * 1.05) === 0, 'the enemy is already yielding outside its preferred range');
    assert(at(near * 0.5) === 1, 'the enemy never fully yields even well inside');
    // the whole point: no single step across the band moves it very far
    let worst = 0, prev = at(near * 1.1);
    for (let d = near * 1.1; d > near * 0.5; d -= 0.02) {
      const v = at(d);
      worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    // 2 cm of approach is about one frame at a sprint; a hard threshold would
    // show a full 1.0 step here, which is exactly what the old code did.
    assert(worst < 0.15,
      `the yield jumps ${worst.toFixed(2)} in 2 cm of approach — that is a threshold, not a band`);
    return `ramps over ${(near * 0.45).toFixed(2)} m, worst step ${worst.toFixed(3)}`;
  });

  check('retreat: every archetype has room to yield inside its preferred range', () => {
    const rows = [];
    for (const [key, A] of Object.entries(ARCHETYPES)) {
      if (A.inert || !A.preferred) continue;
      const [near, far] = A.preferred;
      if (near === 0 && far === 0) continue;      // training dummies stand still
      assert(far > near, `${key} has preferred [${near}, ${far}] — inverted`);
      // the band the blend ramps across has to be wide enough to be felt
      assert(near * 0.45 > 0.35 || A.melee,
        `${key} yields across only ${(near * 0.45).toFixed(2)} m, which is one frame at a run`);
      rows.push(`${key} ${near}-${far}`);
    }
    return `${rows.length} archetypes`;
  });
}
