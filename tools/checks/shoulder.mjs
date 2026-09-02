/**
 * THE RETICLE STAYS ON THE SIDE OF THE HEAD IT STARTED ON.
 *
 * "the game will start with the cursor to the right of the player's head and
 *  suddenly you notice things feel strange and you notice that the cursor is
 *  now to the left of the player's head … if you keep playing it will somehow
 *  revert back to normal"
 *
 * That was `CameraRig._resolveShoulder` flipping `shoulderSide` on a wall
 * raycast every sixth frame. The rule now: a wall on the aiming side takes
 * the OFFSET (the camera eases onto the centreline) and never the SIDE. This
 * suite drives the real resolver with a physics stub that puts a wall on one
 * side, then the other, then nowhere, and holds the side through all of it.
 */
import * as THREE from 'three';
import { CameraRig } from '../../src/game/Player.js';

const UP = new THREE.Vector3(0, 1, 0);

function rigWithWall(where) {
  const rig = new CameraRig(new THREE.PerspectiveCamera());
  /* A wall `where` metres to the right (+) or left (−) of the body, parallel
   * to the view: a backward ray from an origin on that side is short. */
  const physics = {
    raycast(origin) {
      if (where === null) return null;
      const side = Math.sign(origin.x);
      if (side !== Math.sign(where)) return null;
      return { distance: 0.35 };
    },
  };
  return { rig, ctx: { physics } };
}

function settle(rig, ctx, frames = 120) {
  const base = new THREE.Vector3(0, 1.5, 0);
  const fwd = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  let at = rig.shoulderAt;
  for (let i = 0; i < frames; i++) at = rig._resolveShoulder(1 / 60, base, fwd, right, ctx);
  return at;
}

export async function run({ check, assert }) {
  check('shoulder: a wall on the aiming side pulls the camera in and never across', () => {
    const { rig, ctx } = rigWithWall(+1);
    const side0 = rig.shoulderSide;
    const open = rig.shoulderAt;
    const at = settle(rig, ctx);
    assert(rig.shoulderSide === side0, `the side flipped: ${side0} → ${rig.shoulderSide}`);
    assert(at > 0 && at < open * 0.35, `the offset did not give way to the wall: ${at.toFixed(3)} of ${open}`);
    /* And the wall going away gives it back, on the same side. */
    ctx.physics.raycast = () => null;
    const back = settle(rig, ctx);
    assert(rig.shoulderSide === side0, 'the side flipped on the way back out');
    assert(Math.abs(back - open) < 0.02, `did not come back out: ${back.toFixed(3)} of ${open}`);
    return `wall: ${at.toFixed(2)} m, clear: ${back.toFixed(2)} m, side ${side0} throughout`;
  });

  check('shoulder: a wall on the OTHER side is not the camera\'s business', () => {
    const { rig, ctx } = rigWithWall(-1);
    const open = rig.shoulderAt;
    const at = settle(rig, ctx);
    assert(rig.shoulderSide === 1, `the side flipped to ${rig.shoulderSide}`);
    assert(Math.abs(at - open) < 1e-3, `the offset moved for a wall on the free side: ${at.toFixed(3)}`);
    return `${at.toFixed(2)} m, unchanged`;
  });

  check('shoulder: nothing in the game writes shoulderSide but the constructor', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const writes = [...src.matchAll(/this\.shoulderSide\s*=\s*[^=]/g)];
    assert(writes.length === 1, `${writes.length} writers of shoulderSide (want the constructor only)`);
    return 'one writer, the constructor';
  });
}
