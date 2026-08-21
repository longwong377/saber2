/* Probe: who fires during break.mjs's REFUSE window? */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('needs --import ./tools/register.mjs'); process.exit(2); }
const { MORALE } = await import('../src/game/Morale.js');
const H = await import('./checks/_coop.mjs');
const STEP = 1 / 30;
const { world } = await H.bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
const p = world.player;
p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
p.saber.ignite(); p.saber.ignition = 1;
const idle = H.idleInput();
const bearing = new THREE.Vector3();
const RANGE = 9;
const rank = (n, range, type) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = world.spawnEnemy(type, new THREE.Vector3(0, 0, range));
    if (e) { e.position.y = (world.terrain?.height(0, range) ?? 0) + 0.02; out.push(e); }
  }
  return out;
};
let t = 0;
const at = (nerve, shadow = false, label = '') => {
  const [e] = rank(1, RANGE, 'b1');
  e.hp = 1e6;
  let shots = 0, mine = 0;
  const others = new Map();
  const fire = world.bolts.fire.bind(world.bolts);
  world.bolts.fire = (from, dir, opts = {}) => {
    shots++;
    if (opts.owner === e) mine++;
    else { const k = opts.owner?.type || opts.owner?.constructor?.name || 'none'; others.set(k, (others.get(k) || 0) + 1); }
    return fire(from, dir, opts);
  };
  for (let i = 0; i < 120; i++) {
    e.nerve = nerve;
    world.update(STEP, idle); t += STEP;
    if (shadow) {
      bearing.subVectors(p.position, e.position).setY(0);
      if (bearing.lengthSq() > 1e-6) {
        bearing.normalize();
        p.position.x = e.position.x + bearing.x * RANGE;
        p.position.z = e.position.z + bearing.z * RANGE;
      }
    }
  }
  world.bolts.fire = fire;
  console.log(`${label.padEnd(12)} t=${t.toFixed(1)}s nerve=${nerve.toFixed(3)} shots=${shots} mine=${mine} `
    + `others=${[...others].map(([k, v]) => k + ':' + v).join(',') || '-'} enemies=${world.enemies.length} wave=${world.director?.wave}`);
  e.dead = true; e.dispose?.();
  const ix = world.enemies.indexOf(e); if (ix >= 0) world.enemies.splice(ix, 1);
};
const home = p.position.clone();
at(1, false, 'steady');
p.position.copy(home);
at((MORALE.BREAK + MORALE.REFUSE) / 2, false, 'broken');
p.position.copy(home);
at(1, true, 'gunSteady');
at((MORALE.BREAK + MORALE.REFUSE) / 2, true, 'gunBroken');
at(MORALE.REFUSE * 0.4, true, 'gunRefusing');
world.unload();
