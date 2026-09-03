/**
 * HOW FAR EACH SET ACTUALLY REACHES — measured against a real body in a real
 * world, by walking a dummy outward until the blade stops touching it.
 *
 * Not `base.distanceTo(tip)`: that is the blade's own length and it is the same
 * 1.15 m in all three sets. What a player feels as reach is how far from their
 * own feet a contact happens, which is the hands plus the hilt plus the blade
 * plus whatever the lunge adds — and for a saberstaff, plus the shaft.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { SABER_SETS } = await import('../src/game/SaberSet.js');
const STEP = 1 / 60;

export async function reachOf(setId, { dists = [1.6, 1.8, 2.0, 2.1, 2.2, 2.3, 2.4, 2.6], swings = 10 } = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', saberSet: setId },
    runSeed: 5,
  });
  const p = world.player;
  let want = false;
  const drv = idleInput();
  drv.actHit = (a) => (a === 'thrust' && want) ? (want = false, true) : false;
  for (let i = 0; i < 60; i++) world.update(STEP, drv);
  for (const e of world.enemies) e.dispose();
  world.enemies.length = 0;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.aimQuat).setY(0).normalize();

  const hits = new Map();
  let far = 0;
  const orig = world._applyBladeEvent.bind(world);
  world._applyBladeEvent = (pl, ev, dt) => {
    if (ev.point) far = Math.max(far, Math.hypot(ev.point.x - p.position.x, ev.point.z - p.position.z));
    return orig(pl, ev, dt);
  };
  for (const d of dists) {
    for (const e of world.enemies) e.dispose();
    world.enemies.length = 0;
    const at = p.position.clone().addScaledVector(fwd, d);
    at.y = world.terrain.height(at.x, at.z);
    const e = world.spawnEnemy('b1', at);
    e.hp = e.maxHp = 1e9;
    let n = 0;
    const seen = () => n;
    const o2 = world._applyBladeEvent;
    world._applyBladeEvent = (pl, ev, dt) => { n++; return o2(pl, ev, dt); };
    for (let f = 0; f < 30 * swings; f++) {
      e.position.copy(at); e.chest?.setY?.(at.y + 1.1);
      if (f % 30 === 0) want = true;
      world.update(STEP, drv);
    }
    world._applyBladeEvent = o2;
    hits.set(d, seen());
  }
  const reached = [...hits.entries()].filter(([, n]) => n > 0).map(([d]) => d);
  const out = { id: setId, hits, far, max: reached.length ? Math.max(...reached) : 0 };
  world.unload();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const S of SABER_SETS) {
    const r = await reachOf(S.id);
    console.log(`${S.id.padEnd(7)} furthest contact ${r.far.toFixed(2)} m  body reached to ${r.max.toFixed(1)} m  `
      + [...r.hits].map(([d, n]) => `${d}:${n}`).join(' '));
  }
}
