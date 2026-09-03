/**
 * THE SPIN BARRIER, DRIVEN — *"pure telekinesis to spin the staff at high
 * speeds around your body like a protective barrier, KEEPING YOUR HANDS FREE
 * TO CAST WHATEVER."*
 *
 * Two questions, both measured rather than argued: does it stop anything, and
 * can you cast while it runs.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const H = await import('./checks/_coop.mjs');
const STEP = 1 / 60;

export async function bootStaff(set = 'staff') {
  const { world } = await H.bootWorld({
    level: 'colosseum',
    settings: { mode: 'waves', quality: 'low', instantSpawn: true, saberSet: set },
  });
  const p = world.player;
  const input = H.idleInput();
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  p.force = p.maxForce; p.hp = p.maxHp; p.stamina = 100;
  const ctx = { input, terrain: world.terrain, physics: world.physics,
    particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
    time: world.time, enemies: world.enemies, players: world.players };
  /** One bolt at the chest from `dist` metres away, `a` radians off the
   *  player's own sightline — so "in front" means in front of THEM. */
  const shoot = (dist, a = 0, dy = 0) => {
    /* THE SHOOTER STANDS IN FRONT OF THE PLAYER AND FIRES BACK. The first cut
     * of this put him `-dist` along the aim, i.e. nine metres BEHIND, and then
     * asked why a frontal barrier was not answering. */
    const away = p.aimDir.clone().setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const from = p.chest.clone().addScaledVector(away, dist);
    from.y += dy;
    return world.bolts.fire(from, away.clone().negate().normalize(), { speed: 60, team: 1, damage: 10 });
  };
  const step = (n = 30) => { for (let i = 0; i < n; i++) world.update(STEP, input); };
  return { world, p, ctx, input, shoot, step };
}

/**
 * Bolts fired ONE AT A TIME down the sightline, and how many landed.
 *
 * `spin` re-raises the barrier before every shot and refills the bar, because
 * `ORBIT.cap` is 4.0 s and a stream of 24 shots is longer than that — the first
 * cut of this measured 11/24 against 12/24 and the difference was entirely that
 * the staff had run out and come home a third of the way in.
 */
export function stream(b, { n = 24, spread = 0.35, spin = false } = {}) {
  let landed = 0, fired = 0, up = 0;
  for (let i = 0; i < n; i++) {
    b.p.hp = b.p.maxHp;
    if (spin) {
      b.p.force = b.p.maxForce; b.p.stamina = 100;
      if (b.p.throwState !== 'orbit') { b.p.throwState = 'held'; b.p.spinBarrier(b.ctx); b.step(12); }
      if (b.p.throwState === 'orbit') up++;
    }
    const hp = b.p.hp;
    b.shoot(9, (i % 7 - 3) * spread / 3, (i % 5 - 2) * 0.10);
    fired++;
    b.step(11);
    if (b.p.hp < hp - 1e-6) landed++;
  }
  return { fired, landed, up };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const set of ['single', 'staff']) {
    const b = await bootStaff(set);
    const bare = stream(b, {});
    console.log(`${set.padEnd(7)} no spin: ${bare.landed}/${bare.fired} bolts landed`);
    if (set === 'staff') {
      const up = stream(b, { spin: true });
      console.log(`${set.padEnd(7)} spin up: ${up.landed}/${up.fired} landed (spinning for ${up.up} of them)`);
      b.p.force = b.p.maxForce;
      if (b.p.throwState !== 'orbit') { b.p.throwState = 'held'; b.p.spinBarrier(b.ctx); b.step(12); }
      const before = b.p.force;
      b.p.forcePush(b.ctx);
      console.log(`${set.padEnd(7)} hands on hilt ${b.p.handsOnHilt()}; a push mid-spin spends `
        + `${(before - b.p.force).toFixed(0)} Force and leaves it turning: ${b.p.throwState === 'orbit'}`);
    }
    b.world.unload();
  }
}
