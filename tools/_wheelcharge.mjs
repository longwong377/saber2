/**
 * CAN THE CHARGED OVERHEAD BE REACHED ON THE SHIPPED BINDINGS?
 *
 *   node --import ./tools/register.mjs tools/_wheelcharge.mjs
 *
 * `CHARGE` is a whole feature — five constants, a pinned wind-up, a rescaled
 * envelope — answering player note #15, "a charged heavy". It is driven by
 * `input.act('attackOver')` being TRUE while `swingT >= OVERHEAD.wind`, i.e.
 * for at least six frames after the press.
 *
 * `attackOver` ships bound to `WheelUp`, and `Input._wheelCode`'s own note is
 * exact about what that is: "`mouse.wheel` accumulates Math.sign(deltaY) over
 * the frame and is cleared by end(), so it is already an edge: down and hit
 * are the same question and both are true for exactly the one frame the notch
 * landed on."
 *
 * One frame is not six. Measured through the real `Input` and the real
 * `SaberController`, holding as hard as each device can:
 *
 *     wheel notch   held 1 frame     charge reached 0.000 of 0.85
 *     pad PadUp     held 140 frames  charge reached 0.850 of 0.85
 *
 * So on mouse and keyboard the charged overhead cannot be reached at all, on
 * the bindings the game ships. It works on a pad, and it works for anyone who
 * rebinds the row — which is why this is a reachability finding rather than
 * dead code. `tools/checks/directional.mjs` cannot see it: its input stub
 * holds `attackOver` in a Set for as long as it likes, which no mouse can.
 *
 * The mouse player is not without a chargeable heavy — the third press of the
 * left button's sequence is one, and it is holdable — so the fix is a design
 * call about the wheel row rather than a defect repair, and it is left to the
 * owner of Bindings.js's layout.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { SaberController, CHARGE, OVERHEAD } from '../src/game/SaberController.js';
import { Input } from '../src/engine/Input.js';
import { defaultBindings, ACTIONS } from '../src/engine/Bindings.js';

const row = ACTIONS.find((a) => a.id === 'attackOver');
console.log('attackOver default keys:', row.keys, 'pad:', row.pad);

const inp = new Input(globalThis.document?.body ?? {});
inp.setBindings(defaultBindings());

const CHEST = new THREE.Vector3(0, 1.35, 0), AIM = new THREE.Quaternion();
const DT = 1 / 60;

function drive(holdFrames, { pad = false } = {}) {
  const c = new SaberController({ scheme: 'directional' });
  c.reset(CHEST, AIM);
  let charged = 0, sawHeld = 0;
  for (let f = 0; f < 140; f++) {
    // The one thing the player can actually do: notch the wheel, or hold the pad.
    if (pad) { if (f < holdFrames) inp.padDownSet.add('PadUp'); else inp.padDownSet.delete('PadUp'); if (f === 0) inp.padPressedSet.add('PadUp'); else inp.padPressedSet.delete('PadUp'); }
    else inp.mouse.wheel = f === 0 ? -1 : 0;
    if (inp.act('attackOver')) sawHeld++;
    c.applyInput(inp, DT, { stamina: 1 });
    c.update(DT, CHEST, AIM, { stamina: 1 });
    charged = Math.max(charged, c.charge, c.charged);
    inp.end();
  }
  return { charged, sawHeld };
}
const wheel = drive(140);
const pad = drive(140, { pad: true });
console.log(`wheel notch : held for ${wheel.sawHeld} frames, charge reached ${wheel.charged.toFixed(3)} of ${CHARGE.full}`);
console.log(`pad held    : held for ${pad.sawHeld} frames, charge reached ${pad.charged.toFixed(3)} of ${CHARGE.full}`);
console.log(`(the charge only starts once swingT >= OVERHEAD.wind = ${OVERHEAD.wind}s = ${Math.ceil(OVERHEAD.wind * 60)} frames)`);
