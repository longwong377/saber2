/**
 * DOES A DEAD DUELLIST'S SABER HANG IN THE AIR?
 *
 * "when lightsaber having enemies died their sabers would stay suspended on and
 *  in the air, they should fall to the ground their user is dead, sometimes
 *  retracting automatically, sometimes staying on and on the floor"
 *
 * `Enemy._pose` returns early on `actor.ragdolled` and a dead body ragdolls, so
 * `saber.setHiltPose` stops being called — the hilt keeps the last pose it was
 * given, forever, wherever the hand happened to be. This measures exactly that:
 * where the hilt is, and whether it is still lit, ten seconds after the body
 * that was holding it fell.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');
const { enemyRng } = await import('../src/game/Enemy.js');
enemyRng.seed(11);
const { world } = await bootWorld({ level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const input = idleInput();
const p = world.player;
const at = new THREE.Vector3(p.position.x + 4, p.position.y, p.position.z - 5);
const foe = world.spawnEnemy('acolyte', at);
for (let i = 0; i < 60; i++) world.update(1 / 60, input);
/* WORLD SPACE, and the first draft of this probe read `.position` — which is
 * LOCAL, and a saber whose root has been re-homed onto a ragdoll holder
 * therefore reported the holder's own offset and looked like a hilt on the
 * floor. `getWorldPosition` is the only honest answer to "where is it". */
const worldY = () => foe.saber.root.getWorldPosition(new THREE.Vector3()).y;
console.log(`alive: hilt at y=${worldY().toFixed(2)}, lit=${foe.saber.lit}, parent=${foe.saber.root.parent?.name || foe.saber.root.parent?.type}`);
const ground = world.terrain.height(foe.position.x, foe.position.z);
/* THE CASE THE PLAYER SAW: killed while the body is LIMP. `_pose` returns
 * early on `actor.ragdolled`, so whatever pose the hilt had when the body went
 * limp is the pose it keeps — and a duellist that has just been thrown or
 * blasted is limp with its arm wherever the throw left it. */
foe.actor.goRagdoll(new THREE.Vector3(0, 6, 0), new THREE.Vector3(2, 0, 1));
for (let i = 0; i < 20; i++) world.update(1 / 60, input);
console.log(`limp: hilt at y=${worldY().toFixed(2)}, lit=${foe.saber.lit}, parent=${foe.saber.root.parent?.name || foe.saber.root.parent?.type}`);
foe.die(foe.position.clone(), null, 'probe');
for (let i = 0; i < 60 * 10; i++) world.update(1 / 60, input);
const y = worldY();
console.log(`10 s dead: hilt at y=${y.toFixed(2)} (ground ${ground.toFixed(2)}), lit=${foe.saber.lit}, `
  + `body y=${foe.position.y.toFixed(2)}, parent=${foe.saber.root.parent?.name || foe.saber.root.parent?.type}`);
const hilts = world.props.filter((x) => x.saber);
console.log(`dropped hilts on the ground: ${hilts.length}`
  + (hilts.length ? ` — first at y=${hilts[0].body.position.y.toFixed(2)}, lit=${!!hilts[0].saberLit}` : ''));
console.log(y - ground > 0.9
  ? `THE SABER IS HANGING: ${(y - ground).toFixed(2)} m off the ground with its owner dead`
  : 'the saber came down');
