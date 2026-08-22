/**
 * THE INVISIBLE TROOPS PROBE — the grip path.
 * "troops go completely invisible a lot like I see their names above their
 *  heads but they're invisible, I can still throw them around though."
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');
const { enemyRng } = await import('../src/game/Enemy.js');
enemyRng.seed(31);
const { world } = await bootWorld({ level:'colosseum', settings:{ mode:'waves', quality:'low', instantSpawn:true } });
const p = world.player;
const input = idleInput();
const ctx = { input, physics: world.physics, terrain: world.terrain, particles: world.particles, enemies: world.enemies, players: world.players };
const spawn = () => world.spawnEnemy('b1', new THREE.Vector3(p.position.x, p.position.y, p.position.z - 4));
const vis = (e) => (e.rig?.root?.visible);

// 1. grip, then the gripper dies
const a = spawn();
for (let i=0;i<10;i++) world.update(1/60, input);
p.gripEnemy = a; a.gripped = true;
a.actor?.goRagdoll?.(a.velocity.clone(), null);
console.log(`gripped: visible=${vis(a)} ragdolled=${!!a.actor?.ragdolled} gripped=${a.gripped}`);
p.hp = 0; p.alive = false;                    // the gripper dies holding it
for (let i=0;i<60*12;i++) world.update(1/60, input);
console.log(`after 12 s with a dead gripper: visible=${vis(a)} ragdolled=${!!a.actor?.ragdolled} gripped=${a.gripped} dead=${a.dead} pos=${a.position.toArray().map(v=>v.toFixed(1)).join(',')}`);

// 2. grip, then release properly — the control case
p.alive = true; p.hp = p.maxHp;
const b = spawn();
for (let i=0;i<10;i++) world.update(1/60, input);
p.gripEnemy = b; b.gripped = true; b.actor?.goRagdoll?.(b.velocity.clone(), null);
p.releaseGrip();
for (let i=0;i<60*12;i++) world.update(1/60, input);
console.log(`released properly: visible=${vis(b)} ragdolled=${!!b.actor?.ragdolled} gripped=${b.gripped}`);
