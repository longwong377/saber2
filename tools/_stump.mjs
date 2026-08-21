/**
 * WHAT IS LEFT STANDING AFTER A CUT, AND WHETHER YOU CAN WALK THROUGH IT.
 *
 * `NEXT.md`: "A stump gets a drawn instance and never a collider, so a lopped
 * tree can leave a 20 m spar you walk through."
 *
 * `fell` clamps the cut at `h * 0.92`, so a blade taken high up a 26 m trunk
 * leaves a very tall stump — and `_syncColliders` only ever boxes trees whose
 * STATE is STANDING. This measures the two halves: how tall the tallest stump
 * a cut can leave actually is, and whether anything solid is under it.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');

const { world } = await bootWorld({ level: 'wood', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const F = world.forest, p = world.player, input = idleInput();
const S = 15, X = 0, Z = 1, Y = 2, H = 3, R = 4, STATE = 6, CUT = 11;

/* The tallest trunk within reach, cut as high as the clamp allows. */
let pick = -1, best = 0;
for (let i = 0; i < F.count; i++) {
  const d = Math.hypot(F.data[i * S + X] - p.position.x, F.data[i * S + Z] - p.position.z);
  if (d > 26 || F.data[i * S + H] < best) continue;
  best = F.data[i * S + H]; pick = i;
}
const h = F.data[pick * S + H];
F.fell(pick, 1, 0, h * 0.92);
for (let i = 0; i < 60 * 12; i++) { p.hp = p.maxHp; p.alive = true; world.update(1 / 30, input); }

const cut = F.data[pick * S + CUT];
const x = F.data[pick * S + X], z = F.data[pick * S + Z], y = F.data[pick * S + Y];
console.log(`tree ${pick}: ${h.toFixed(1)} m tall, cut at ${cut.toFixed(1)} m — a ${cut.toFixed(1)} m spar is left standing`);
console.log(`state ${F.data[pick * S + STATE]} (2 = DOWN), stumps drawn ${F.stumpMesh.count}, live colliders ${F.live.size}`);

/* NEAR IT FIRST. The colliders are a RING around the bodies on the field, so a
 * column test taken with the player 26 m away measures the ring's radius and
 * not the stump. */
p.position.set(x - 4, world.terrain.height(x - 4, z) + 0.2, z);
for (let i = 0; i < 40; i++) { p.hp = p.maxHp; p.alive = true; world.update(1 / 60, input); }

/* Anything solid in the spar's own column? */
let found = null;
for (const b of world.physics.staticBoxes) {
  if (b.userData?.tree !== pick) continue;
  found = b;
}
console.log('boxes tagged as this tree:', world.physics.staticBoxes.filter(b => b.userData?.tree === pick).length,
  'stump-tagged:', world.physics.staticBoxes.filter(b => b.userData?.stump).length,
  'live has it:', F.live.has(pick));
console.log(found
  ? `a collider stands in it: half ${found.halfExtents.toArray().map(v => v.toFixed(2)).join(',')}`
  : 'NOTHING SOLID IN THE COLUMN — you walk through it');

/* And drive the player at it, which is the reading that matters. */
const into = new THREE.Vector3(1, 0, 0);
const from = new THREE.Vector3(x - 3, 0, z);
from.y = world.terrain.height(from.x, from.z) + 0.2;
p.position.copy(from); p.velocity.set(0, 0, 0);
p.aimDir.copy(into);
if (p.camera) { p.camera.yaw = Math.atan2(-into.x, -into.z); p.camera.pitch = 0; }
const wish = { x: 0, y: 1 };
const drive = { ...input, moveAxis: (o) => { if (o) { o.x = wish.x; o.y = wish.y; return o; } return { ...wish }; } };
for (let i = 0; i < 60 * 4; i++) { p.hp = p.maxHp; p.alive = true; world.update(1 / 60, drive); }
const through = (p.position.x - x);
console.log(`walked from 3 m short of the trunk: finished ${through.toFixed(2)} m past its axis `
  + `(positive = through the spar)`);
