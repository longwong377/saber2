/**
 * WHY A LINE DOES NOT RE-FORM AFTER A BARRAGE — the reproduction for
 * `tools/checks/levers.mjs`'s second arm, so nobody has to take the
 * measurement again.
 *
 *   node --import ./tools/register.mjs tools/_levprobe.mjs
 *
 * The fixture is `levers.mjs`'s own, line for line: geonosis, runSeed 9, ten
 * men in a circle of radius 4 on their general, twelve shells, and then
 * twenty-five seconds in which nothing else happens to them. What the check
 * asks is that `lineGathered` comes back true — the survivors walk back to
 * where they were told to stand — and it does not.
 *
 * TWO SEPARATE THINGS ARE WRONG and both are printed here.
 *
 *   THE ONE WHO CANNOT GET PAST SOMETHING. Thrown 48 m clear, he meets a
 *   rock on the way home and goes round it — and used to go round it FOREVER:
 *   a 77-frame closed circuit between (40.8, 26.3) and (36.8, 26.5), the same
 *   three decimal places every lap, walked at 4 m/s while `_stuckT` read zero
 *   because he was covering ground. `SIDE_HOLD` and `SIDE_JUDGE` in Enemy.js
 *   broke the exact loop; he makes net ground now and still bounces between
 *   37 and 46 m, so the side he commits to is still not always the way past.
 *
 *   THE ONE WHO IS IN NO HURRY. The other survivor is on 7 of 46 hp and
 *   crouched at 0.80, and he creeps: a wish for a few frames, a metre of
 *   ground, then several seconds with no wish at all. 48 m to 19 m in
 *   twenty-five seconds is 1.16 m/s against a `speed` of 3.8. Whether a
 *   badly hurt man SHOULD hurry is a design question — §4.3 asks that a lever
 *   buy time rather than the battle, and at this pace it buys the battle —
 *   but it is not a navigation defect and it is most of why the check is red.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { MORALE } = await import('../src/game/Morale.js');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'theline', level: 'geonosis', quality: 'low' }, runSeed: 9,
});
const d = world.command; d.start(1); const c = d.commander; c.player = world.player;
world.player.position.set(0, world.terrain.height(0, 0), 0);
const mine = world.player.team ?? 0;
for (let i = world.enemies.length - 1; i >= 0; i--) {
  const e = world.enemies[i];
  if (e.team === mine) continue;
  e.dispose?.(); world.enemies.splice(i, 1);
}
world.director.active = false; world.director.spawnQueue.length = 0;
const men = d.roster.living.map((t) => t.body).filter(Boolean);
men.forEach((e, i) => {
  const a = (i / men.length) * Math.PI * 2;
  e.position.set(Math.sin(a) * 4, 0, Math.cos(a) * 4);
  e.position.y = world.terrain.height(e.position.x, e.position.z);
});
d.order('circle', c); d._troops(1 / 30, {});
console.log(`MORALE.NEAR ${MORALE.NEAR} · ${men.length} men · gathered ${d.lineGathered(c)}`);

const ctx = world._frameCtx || { world, enemies: world.enemies, terrain: world.terrain,
  physics: world.physics, particles: world.particles };
const S = world.player.stratagems;
for (let i = 0; i < 12; i++) {
  const at = V(c.player.position.x + (i - 5.5) * 3.4, 0, c.player.position.z + ((i % 3) - 1) * 2.6);
  at.y = world.terrain.height(at.x, at.z);
  S.blast(ctx, at, 6.5, 70, 120, { core: 0.25, size: 1.7, crater: 0.9 });
}
for (let i = 0; i < 60; i++) world.update(1 / 30, idle);

const line = (t) => {
  const alive = men.filter((e) => !e.dead);
  console.log(`${t}\talive ${alive.length}\tgathered ${d.lineGathered(c)}\t`
    + alive.map((e) => `${e.id} ${e.downed ? 'DOWN ' : ''}hp${(e.hp || 0).toFixed(0)} `
      + `${e.position.distanceTo(world.player.position).toFixed(0)}m crouch${(e.crouch || 0).toFixed(2)}`).join(' · '));
};
line('after');
for (let s = 0; s < 5; s++) { for (let i = 0; i < 30 * 5; i++) world.update(1 / 30, idle); line(`t+${(s + 1) * 5}`); }

/* And then one of them, frame by frame, which is where both findings came
 * from: an undefined `wish` is a man standing still by his own choice, and a
 * `wish` that swings while the position returns is a man walking a circuit. */
const who = men.filter((e) => !e.dead)[0];
if (who) {
  console.log(`\n${who.id}, ten seconds, every tenth frame:`);
  for (let q = 0; q < 300; q++) {
    world.update(1 / 30, idle);
    if (q % 10) continue;
    console.log(`  ${String(q).padStart(3)} at ${who.position.toArray().map((v) => v.toFixed(2)).join(',')}`
      + `\twish ${who.wish ? who.wish.toArray().map((v) => v.toFixed(2)).join(',') : 'none'}`
      + `\tvel ${who.velocity.toArray().map((v) => v.toFixed(2)).join(',')}`
      + `\twallN ${who._wallN?.lengthSq() > 1e-6 ? 'yes' : 'no'} side ${who._wallSide || 0}`
      + `\tstuckT ${(who._stuckT || 0).toFixed(2)}\tcrouch ${(who.crouch || 0).toFixed(2)}`);
  }
}
