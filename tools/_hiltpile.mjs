/**
 * WHAT A DEAD DUELLIST LEAVES ON THE FLOOR, AND FOR HOW LONG.
 *
 * `Enemy.die` drops the hilt as a real `Prop` — a physics body plus a group of
 * nineteen to thirty-six meshes — and `Dropped.ageDropped` only ever adds to
 * its `dropAge`. Nothing in the game removes one. This counts them.
 *
 *   node --import ./tools/register.mjs tools/_hiltpile.mjs [--waves 6] [--per 8]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const WAVES = Number(flag('waves', '6'));
const PER = Number(flag('per', '8'));
const TYPE = flag('type', 'acolyte');
const STEP = 1 / 30;

const { world } = await bootWorld({
  level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'high' }, runSeed: 7,
});
const input = idleInput();
const run = (s) => { for (let i = 0; i < Math.round(s / STEP); i++) world.update(STEP, input); };

const count = () => {
  let hilts = 0, meshes = 0;
  for (const p of world.props) if (p.saber) { hilts++; p.mesh.traverse((o) => { if (o.isMesh) meshes++; }); }
  return { hilts, meshes, props: world.props.length, bodies: world.physics.bodies.length };
};

console.log(`start ${JSON.stringify(count())}`);
for (let w = 0; w < WAVES; w++) {
  const made = [];
  for (let i = 0; i < PER; i++) {
    const a = (i / PER) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8);
    p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
    const e = world.spawnEnemy(TYPE, p);
    if (e) made.push(e);
  }
  run(1);
  for (const e of made) { e.hp = 0; e.die?.(null, 'probe'); }
  run(45);        // past the 40 s the world gives a corpse
  const c = count();
  console.log(`wave ${w + 1}: killed ${made.length}  hilts=${c.hilts} hiltMeshes=${c.meshes} props=${c.props} bodies=${c.bodies}`);
}
process.exit(0);
