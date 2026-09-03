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
 * Bolts fired ONE AT A TIME at the chest from `bearing`, and how many landed.
 *
 * `spin` re-raises the barrier before every shot and refills the bar, because
 * `ORBIT.cap` is the hard ceiling in seconds and a stream of 24 shots is longer
 * than that — the first cut of this measured 11/24 against 12/24 and the
 * difference was entirely that the staff had run out and come home a third of
 * the way in.
 *
 * ── `bearing`, AND WHY THE VERSION WITHOUT IT MEASURED THE WRONG THING ────
 *
 * Every shot this file fired for its whole life was inside `spread` of the
 * player's own sightline — ±10° at the shipped 0.35 rad. That is the bearing
 * the ORDINARY held guard already covers in every set, so a barrier that
 * answered nothing anywhere else could pass a check that said it stopped bolts.
 * Driven at four more bearings on the tree this replaced:
 *
 *     bearing    0°     45°    90°   135°   180°
 *     spin      0/12   0/12   4/12  6/12   6/12   landed
 *     control   6/12   6/12   5/12  5/12   5/12
 *
 * — behind and off the rear flank the spin stopped NOTHING, because the guard
 * descriptor `Player.bladeGuard` publishes carried `cone = GUARD.reach / 2`,
 * the 100° rose a man holding a hilt cannot see past, copied onto a weapon
 * nobody is holding. A frontal wedge, and the sightline stream could not see
 * it. The claim is COVERAGE, so the instrument has to ask about coverage.
 *
 * `bearing` is radians about UP off the player's own aim, so 0 is the shipped
 * stream to the frame and π is a shot in the back.
 */
export function stream(b, { n = 24, spread = 0.35, spin = false, bearing = 0 } = {}) {
  let landed = 0, fired = 0, up = 0;
  for (let i = 0; i < n; i++) {
    b.p.hp = b.p.maxHp;
    if (spin) {
      b.p.force = b.p.maxForce; b.p.stamina = 100;
      if (b.p.throwState !== 'orbit') { b.p.throwState = 'held'; b.p.spinBarrier(b.ctx); b.step(12); }
      if (b.p.throwState === 'orbit') up++;
    }
    const hp = b.p.hp;
    b.shoot(9, bearing + (i % 7 - 3) * spread / 3, (i % 5 - 2) * 0.10);
    fired++;
    b.step(11);
    if (b.p.hp < hp - 1e-6) landed++;
  }
  return { fired, landed, up };
}

/**
 * The five bearings a barrier round a body has to answer, in degrees.
 *
 * 0 and 45 are inside the 100° shoulder line the ordinary held guard already
 * covers, and are here as the CONTROL on the other three: a rule that only
 * answers where the shipped guard answers has bought nothing. 90 is the flank,
 * 135 the rear quarter and 180 a shot in the back — the three the wedge could
 * not reach and the three "round your body" is a claim about.
 */
export const BEARINGS = [0, 45, 90, 135, 180];

/**
 * The whole rose, spin up against spin down, on ONE player in ONE place.
 *
 * The control arm matters as much as the measured one and for the reason
 * `saberforms`' own note gives: "no bolts got through" means nothing unless
 * they get through otherwise. Both arms are the same bench, the same nine
 * metres and the same bar refilled between shots; the only difference is
 * whether the staff is turning.
 */
export function coverage(b, { n = 12, bearings = BEARINGS } = {}) {
  const rows = [];
  for (const deg of bearings) {
    const bearing = deg * Math.PI / 180;
    lower(b);
    const control = stream(b, { n, bearing });
    /* THE BARRIER IS BROUGHT DOWN BETWEEN THE ARMS AND WAITED OUT. `stream`
     * re-raises it per shot when asked and leaves it turning when it is done,
     * so a control arm run straight after a spin arm would be measuring the
     * spin — and `spinBarrier` on a running ring answers 'returning', not
     * 'held', so the blades are still in the air for the frames it takes them
     * to come home. */
    lower(b);
    const spin = stream(b, { n, bearing, spin: true });
    rows.push({ deg, fired: n, spin: spin.landed, control: control.landed, up: spin.up });
  }
  lower(b);
  return rows;
}

/** The staff back in the hands, however it was in the air. */
export function lower(b) {
  if (b.p.throwState === 'orbit') b.p.spinBarrier(b.ctx);
  for (let i = 0; i < 120 && b.p.throwState !== 'held'; i++) b.step(1);
  return b.p.throwState === 'held';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const set of ['single', 'staff']) {
    const b = await bootStaff(set);
    const bare = stream(b, {});
    console.log(`${set.padEnd(7)} no spin: ${bare.landed}/${bare.fired} bolts landed`);
    if (set === 'staff') {
      const up = stream(b, { spin: true });
      console.log(`${set.padEnd(7)} spin up: ${up.landed}/${up.fired} landed (spinning for ${up.up} of them)`);
      if (b.p.throwState === 'orbit') { b.p.spinBarrier(b.ctx); b.step(12); }
      const rows = coverage(b);
      console.log('\nCOVERAGE — 12 bolts a bearing at 9 m, barrier re-raised and the bar refilled '
        + 'before each shot');
      console.log('  bearing   ' + rows.map((r) => `${r.deg}°`.padStart(6)).join(''));
      console.log('  spin      ' + rows.map((r) => `${r.spin}/${r.fired}`.padStart(6)).join(''));
      console.log('  control   ' + rows.map((r) => `${r.control}/${r.fired}`.padStart(6)).join(''));
      b.p.force = b.p.maxForce;
      if (b.p.throwState !== 'orbit') { b.p.throwState = 'held'; b.p.spinBarrier(b.ctx); b.step(12); }
      const before = b.p.force;
      b.p.forcePush(b.ctx);
      console.log(`\n${set.padEnd(7)} hands on hilt ${b.p.handsOnHilt()}; a push mid-spin spends `
        + `${(before - b.p.force).toFixed(0)} Force and leaves it turning: ${b.p.throwState === 'orbit'}`);
    }
    b.world.unload();
  }
}
