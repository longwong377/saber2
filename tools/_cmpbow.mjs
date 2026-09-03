/* SCRATCH PROBE — can a companion carry a second band at all. Delete me. */
import './dom-shim.mjs';
import * as THREE from 'three';
const STEP = 1 / 30;
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const B = await import('../src/game/Bodies.js');

console.log('BLASTER_LENGTH.bowcaster =', B.BLASTER_LENGTH.bowcaster);

/* Hand the row the gun the weapons lane just built, at runtime. */
Object.assign(ARCHETYPES.wook, {
  weapon: 'bowcaster', ranged: true,
  fireRate: 0.9, burst: 1, spread: 0.10, preferred: [1.6, 3.0],
  boltColor: 0x33ff66,
});

const { world } = await bootWorld({
  level: 'geonosis',
  settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
  runSeed: 21,
});
const input = idleInput(), p = world.player;
const tick = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); } };
tick(30);
const e = C.fieldCompanion(world, p, 'wook', {});
console.log('built weapon?', !!e.weapon, e.weapon?.userData?.kind, 'melee', e.A.melee, 'ranged', e.A.ranged);
const at = new THREE.Vector3(p.position.x + 9, p.position.y, p.position.z);
const foe = world.spawnEnemy('b1', at); foe.team = 1;
let dealt = 0, blows = 0;
const raw = foe.damage.bind(foe);
foe.damage = (a, ...r) => { dealt += a; blows++; foe.hp = foe.maxHp; return raw(a, ...r); };
for (let i = 0; i < 30 * 20; i++) {
  p.hp = p.maxHp; foe.hp = foe.maxHp; foe.position.copy(at);
  world.update(STEP, input);
}
console.log('AS SHIPPED (melee routing): dealt', dealt.toFixed(0), 'blows', blows, 'target', e.target?.type ?? null,
  'dist', e.target ? e.position.distanceTo(e.target.position).toFixed(1) : '-');

/* NOW THE CANDIDATE: hand the shipped ranged brain the frame when the target
 * is out of reach, leaving movement to the companion move wrap. */
const think = e._think.bind(e);
e._think = function (dt, ctx) {
  think(dt, ctx);
  const t = this.target;
  if (!t || t.dead) return;
  const d = this.position.distanceTo(t.position);
  if (d > (this.A.preferred?.[1] ?? 3)) this._rangedBrain(dt, ctx, d);
};
dealt = 0; blows = 0;
for (let i = 0; i < 30 * 20; i++) {
  p.hp = p.maxHp; foe.hp = foe.maxHp; foe.position.copy(at);
  world.update(STEP, input);
}
console.log('WITH A SIDEARM TICK  : dealt', dealt.toFixed(0), 'blows', blows,
  'gap', e.target ? e.position.distanceTo(e.target.position).toFixed(1) : '-',
  'station gap', C.stationGap(e).toFixed(1));
world.unload();
