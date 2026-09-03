/**
 * DOES A PUSH AT THE GROUND THROW YOU OFF IT — the V13 note, measured.
 *
 *   "when you look down … and force push it should throw you into the air …
 *    totally dependent on where you're aiming … based on your distance and
 *    force strength … should work in the air too"
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'waves', level: 'geonosis', quality: 'low' },
});
const p = world.player;
const ctx = world._frameCtx || { world, enemies: world.enemies, physics: world.physics,
  particles: world.particles, terrain: world.terrain, bolts: world.bolts };
const g = (x, z) => world.terrain.height(x, z);
const reset = (y = 0.05) => {
  p.position.set(0, g(0, 0) + y, 0);
  p.velocity.set(0, 0, 0);
  p.grounded = y < 0.2;
  p.force = p.maxForce = 400;
  p.cooldowns.push = 0;
  /* `chest` is written once a frame by _update; a probe that moves the body and
   * pushes in the same tick would be firing from where he was. */
  p.chest.copy(p.position).setY(p.position.y + 1.25);
};
const aim = (x, y, z) => p.aimDir.set(x, y, z).normalize();
const shot = (label) => {
  const v0 = p.velocity.clone();
  p.forcePush(ctx);
  const d = p.velocity.clone().sub(v0);
  console.log(`${label.padEnd(34)} dv ${d.toArray().map((n) => n.toFixed(2)).join(', ').padEnd(24)} `
    + `|dv| ${d.length().toFixed(2).padStart(6)}  up ${d.y.toFixed(2).padStart(6)}`);
  return d;
};

reset(); aim(0,-1,0);
console.log('isLocal', p.isLocal, 'riding', !!p.riding, 'held', !!p.held, 'body?', !!p.body);
console.log('physics?', !!ctx.physics, 'raycast?', typeof ctx.physics?.raycast);
{
  const o = p.chest.clone();
  const d = new THREE.Vector3(0,-1,0);
  const h1 = ctx.physics?.raycast?.(o, d, 20, null);
  console.log('raycast no filter:', h1 ? `d=${h1.distance.toFixed(2)} terrain=${h1.terrain} body=${!!h1.body} invMass=${h1.body?.invMass}` : 'MISS');
  const h2 = ctx.physics?.raycast?.(o, d, 20, (rec) => rec && rec.body !== p.body);
  console.log('raycast filtered:', h2 ? `d=${h2.distance.toFixed(2)} terrain=${h2.terrain} invMass=${h2.body?.invMass}` : 'MISS');
  console.log('recoil returns:', p._pushRecoil(ctx, p.chest, d, 13, 1));
}
console.log('--- aim, and where it throws you (forceScale ' + p.forceScale.toFixed(2) + ')');
reset(); aim(0, -1, 0); shot('straight down');
reset(); aim(0, 1, 0); shot('straight up (sky, no surface)');
reset(); aim(0, 0, -1); shot('level, at open ground ahead');
reset(); aim(0, -0.7, -0.7); shot('down and forward');
reset(); aim(0, -0.7, 0.7); shot('down and behind');

console.log('\n--- height above the ground: the distance term');
for (const h of [0.05, 2, 5, 9, 14, 20]) {
  reset(h); aim(0, -1, 0);
  const d = shot(`from ${String(h).padStart(4)} m up, aimed down`);
  void d;
}

console.log('\n--- force strength');
for (const P of [1, 2, 4]) {
  reset(); world.settings.forcePower = P; aim(0, -1, 0);
  shot(`forceScale ${P}`);
}
