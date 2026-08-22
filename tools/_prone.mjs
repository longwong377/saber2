/**
 * DOES A LINE SHOOT A MAN WHO IS LYING DOWN?
 *
 * Handed over from the OPEN lane: `Enemy.knockFlat` now FELLS a body where it
 * used to stun it upright, so a fight holds far more prone bodies than it did —
 * and the damage the `downed` multiplier buys on LANDED bolts moved the WRONG
 * WAY (8.2% ±2.3 before, 3.7% ±1.4 after). Two candidate causes and only one
 * matters: the mix moved, or the line shoots OVER a body on the ground.
 *
 * The discriminator is a hit rate at MATCHED RANGE against a standing body and
 * a limp one. Everything else is held identical: the same shooters, the same
 * archetype, the same distance, the same frames, the shipped `_shoot`, the
 * shipped `_boltHitTest`, the shipped capsules.
 *
 * IT ALSO PRINTS THE GEOMETRY, because a hit rate alone cannot say WHY: `aimY`
 * is where `aimAt` — the one reader every shooter in the game uses — puts the
 * point, and `capTop` is the highest thing the body actually presents to a
 * bolt. `over` is the difference. A positive `over` is a line firing above a
 * body that is lying in front of it.
 *
 *   node --import ./tools/register.mjs tools/_prone.mjs [--range 12] [--seconds 90]
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const RANGE = Number(flag('range', '12'));
const SECONDS = Number(flag('seconds', '90'));
const SEED = Number(flag('seed', '11'));
const TYPE = flag('type', 'b1');
const GUNS = Number(flag('guns', '8'));
const STEP = 1 / 30;
/** Frames the mark is left standing so its rig is posed before it is felled.
 *  `Actor.centre` answers (0,0,0) on a body that has never been posed, and
 *  `_move`'s LIMP branch writes that straight into `position` — a mark that
 *  teleports onto the firing line. */
const SETTLE = 40;

async function arm(prone) {
  const { enemyRng } = await import('../src/game/Enemy.js');
  enemyRng.seed(SEED);
  const { world } = await bootWorld({
    level: 'colosseum',
    settings: { mode: 'waves', level: 'colosseum', difficulty: 'knight', quality: 'low' },
  });
  const input = idleInput();
  const g = (x, z) => world.terrain.height(x, z);

  const mark = world.spawnEnemy(TYPE, new THREE.Vector3(0, g(0, 0), 0));
  mark.team = 0;
  const guns = [];
  for (let i = 0; i < GUNS; i++) {
    const a = (i / GUNS) * Math.PI * 2;
    const x = Math.cos(a) * RANGE, z = Math.sin(a) * RANGE;
    const e = world.spawnEnemy(TYPE, new THREE.Vector3(x, g(x, z), z));
    guns.push(e);
  }
  /* THE ONE HARNESS OVERRIDE, and it is about WHO not about WHERE: `pickTarget`
   * only crosses armies in the three Command modes, and this probe is about the
   * aim, not about target selection. Nothing else in the shot path is touched. */
  const gunSet = new Set(guns);
  world.pickTarget = (e) => (gunSet.has(e) ? mark : null);

  /* COUNTED THROUGH THE SHIPPED DOORS. `Bolts.fire` for shots away and
   * `World._boltHurt` for bolts that found a bone: neither is restated here. */
  let shots = 0, hits = 0, dmg = 0;
  /* THE MARK TAKES NO CONSEQUENCES. `Enemy.damage` is where a bolt becomes a
   * knockback, a stagger and — since `knockFlat` — a body on the floor, and a
   * standing arm whose mark is felled by the third bolt is not a standing arm.
   * Stubbed AFTER `_boltHurt` has counted, so the hit still counts and nothing
   * moves. */
  mark.damage = () => false;
  const fireBase = world.bolts.fire.bind(world.bolts);
  world.bolts.fire = (from, dir, opts) => { if (gunSet.has(opts?.owner)) shots++; return fireBase(from, dir, opts); };
  const hurtBase = world._boltHurt.bind(world);
  world._boltHurt = (e, d, hit, bolt) => { if (e === mark) { hits++; dmg += d; } return hurtBase(e, d, hit, bolt); };

  const { aimAt } = await import('../src/game/Combat.js');
  const _a = new THREE.Vector3();
  let aimY = 0, capTop = 0, capBot = 0, n = 0, range = 0;

  for (let i = 0; i < SETTLE + Math.round(SECONDS / STEP); i++) {
    if (prone && i >= SETTLE && mark.actor && !mark.actor.ragdolled) {
      mark.actor.goRagdoll(new THREE.Vector3(0, 0, 0), null);
    }
    if (!prone && mark.actor?.ragdolled) mark.recover(0);
    world.update(STEP, input);
    /* IMMORTAL AND STATIONARY, so the arm measures aim and nothing else. */
    mark.hp = mark.maxHp;
    mark.stopFiring();
    mark.wish = null;
    mark._recoverAt = 0;                 // it stays down for the whole arm
    mark.position.set(0, g(0, 0), 0);
    mark.velocity.set(0, 0, 0);
    for (let k = 0; k < guns.length; k++) {
      const e = guns[k];
      const a = (k / GUNS) * Math.PI * 2;
      const x = Math.cos(a) * RANGE, z = Math.sin(a) * RANGE;
      e.hp = e.maxHp; e.position.set(x, g(x, z), z); e.velocity.set(0, 0, 0);
    }
    if (i < SETTLE + 20) continue;
    aimAt(mark, _a);
    const caps = mark.capsules();
    let lo = Infinity, hi = -Infinity;
    for (const c of caps) { lo = Math.min(lo, c.p0.y - c.r, c.p1.y - c.r); hi = Math.max(hi, c.p0.y + c.r, c.p1.y + c.r); }
    aimY += _a.y; capTop += hi; capBot += lo; range += _a.distanceTo(guns[0].chest); n++;
  }
  return {
    arm: prone ? 'PRONE' : 'STANDING',
    shots, hits, rate: shots ? hits / shots : 0, damage: +dmg.toFixed(1),
    down: !!mark.actor?.ragdolled,
    aimY: +(aimY / n).toFixed(3),
    capTop: +(capTop / n).toFixed(3), capBot: +(capBot / n).toFixed(3),
    over: +((aimY / n) - (capTop / n)).toFixed(3),
    range: +(range / n).toFixed(2),
  };
}

const rows = [];
rows.push(await arm(false));
rows.push(await arm(true));
console.log(`\n${GUNS} ${TYPE} guns in a ring at ${RANGE} m on one ${TYPE}, ${SECONDS} game-s per arm, seed ${SEED}`);
console.log('  arm        shots  hits     rate   aimY   capBot..capTop    over   range  down');
for (const r of rows) {
  console.log('  ' + r.arm.padEnd(9) + String(r.shots).padStart(6) + String(r.hits).padStart(6)
    + ('  ' + (r.rate * 100).toFixed(1) + '%').padStart(9)
    + String(r.aimY).padStart(7) + ('   ' + r.capBot + '..' + r.capTop).padEnd(18)
    + String(r.over).padStart(7) + String(r.range).padStart(8) + String(r.down).padStart(7));
}
console.log('');
