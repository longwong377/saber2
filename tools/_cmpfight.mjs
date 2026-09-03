/* SCRATCH PROBE — does a SWORN animal out-fight a STRANGE one. Delete me. */
import './dom-shim.mjs';
import * as THREE from 'three';
const STEP = 1 / 30;
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const K = await import('../src/game/CompanionKinds.js');

const recFor = (xp) => ({ id: 'f' + xp, kind: 'massiff', name: 'B', xp, runs: 0, areas: 0,
  kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] });

async function bout(xp) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
    runSeed: 21,
  });
  const input = idleInput(), p = world.player;
  const tick = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); } };
  tick(30);
  const e = C.fieldCompanion(world, p, 'massiff', { rec: recFor(xp) });
  const stats = { rung: K.rungOf(recFor(xp)).label, maxHp: e.maxHp, dmg: e.attackDamage, speed: e.speed };

  /* A DUMMY IT CANNOT KILL, so both bouts get the same number of swings. */
  const at = new THREE.Vector3(p.position.x + 2.0, p.position.y, p.position.z + 2.0);
  const foe = world.spawnEnemy('b1', at);
  foe.team = 1;
  let dealt = 0;
  const raw = foe.damage.bind(foe);
  foe.damage = (a, ...r) => { dealt += a; foe.hp = foe.maxHp; return raw(a, ...r); };
  for (let i = 0; i < 30 * 30; i++) {
    p.hp = p.maxHp ?? 100; foe.hp = foe.maxHp; e.hp = e.maxHp;
    foe.position.copy(at);
    world.update(STEP, input);
  }
  stats.dealt = dealt;

  /* AND HOW MUCH AIMED FIRE IT TAKES BEFORE IT FALLS. */
  const e2 = C.fieldCompanion(world, p, 'massiff', { rec: recFor(xp) });
  let hits = 0;
  const src = { team: 1, position: e2.position.clone() };
  while (!e2.dead && hits < 500) { e2.damage(20, e2.position.clone(), src, 'bolt'); hits++; }
  stats.hits = hits;
  world.unload();
  return stats;
}

const a = await bout(0), b = await bout(20);
console.log('STRANGE', JSON.stringify(a));
console.log('SWORN  ', JSON.stringify(b));
console.log('ratios  dealt', (b.dealt / a.dealt).toFixed(3), 'hits', (b.hits / a.hits).toFixed(3),
  'maxHp', (b.maxHp / a.maxHp).toFixed(3), 'dmg', (b.dmg / a.dmg).toFixed(3), 'speed', (b.speed / a.speed).toFixed(3));
