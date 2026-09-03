/** Scratch probe: what the deck body's legs do. Not a check. */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const Kn = await import('../src/game/Kennel.js');
const K = await import('../src/game/CompanionKinds.js');
const STEP = 1 / 30;
const kind = process.argv[2] || 'massiff';
Kn.clear();
Kn.adopt(kind, 'Borz');
const { world } = await bootWorld({
  level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0, quality: 'low' }, runSeed: 2,
});
const input = idleInput();
for (let i = 0; i < 60; i++) world.update(STEP, input);
const fig = world._companionDeck;
if (!fig) { console.log(kind, 'NO FIG'); process.exit(1); }
const rig = fig.built.rig;
const names = [...rig.bones.keys()].filter((n) => /^(hipL|femur|tibia|tarsus)\d+$|^(thigh|shin|foot)[LR]$/.test(n));
const rest = new Map(names.map((n) => [n, rig.get(n).obj.quaternion.clone()]));
const maxRot = new Map(names.map((n) => [n, 0]));
const p = world.player;
const from = p.position.clone();
for (let i = 0; i < 30 * 6; i++) {
  p.position.x += 4 * STEP;
  world.update(STEP, input);
  for (const n of names) maxRot.set(n, Math.max(maxRot.get(n), rig.get(n).obj.quaternion.angleTo(rest.get(n))));
}
console.log(`${kind}: path=${fig.path} walked ${p.position.distanceTo(from).toFixed(2)} m phase=${fig.phase.toFixed(2)} sit=${fig.sit.toFixed(2)}`);
console.log('  walk max rot:', names.map((n) => `${n} ${maxRot.get(n).toFixed(3)}`).join('  '));
// now sit
for (let i = 0; i < 30 * 5; i++) world.update(STEP, input);
console.log(`  sat=${fig.sit.toFixed(2)}`);
const sitRot = names.map((n) => `${n} ${rig.get(n).obj.quaternion.angleTo(rest.get(n)).toFixed(3)}`);
console.log('  sit rot:  ', sitRot.join('  '));
const w = (n) => { const v = rig.worldPos(n, new THREE.Vector3()); return `${n}(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`; };
const bones = ['hips', 'body', 'head', ...names];
console.log('  sat world:', bones.filter((b) => rig.get(b)).map(w).join(' '));
console.log('  fig.pos', fig.pos.toArray().map((x) => x.toFixed(2)).join(','), 'facing', fig.facing.toFixed(2),
  'root', fig.root.position.toArray().map((x) => x.toFixed(2)).join(','));
world.unload(); Kn.clear();
process.exit(0);
