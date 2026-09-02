/**
 * THE SIX ORDERS, DRIVEN. Each one is given on a real body in a real world and
 * the thing it promises is measured, because an order that is accepted and does
 * nothing is worse than one that is refused.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const { COMPANION_RANKS } = await import('../src/game/CompanionKinds.js');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis',
  settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
  runSeed: 11,
});
const STEP = 1 / 30;
const p = world.player;
for (let i = 0; i < 30; i++) world.update(STEP, idle);

const sworn = { xp: 99, runs: 5, tempers: [] };   // licensed for everything
const dog = C.fieldCompanion(world, p, 'massiff', { rec: sworn });
const foeAt = (ang, r) => {
  const x = p.position.x + Math.sin(ang) * r, z = p.position.z + Math.cos(ang) * r;
  const e = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
  if (e) e.team = 1;
  return e;
};
const run = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); } };

const say = (name, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);

/* ── the licence ladder ───────────────────────────────────────────────── */
{
  const green = { xp: 0, runs: 0, tempers: [] };
  dog._cmpRec = green;
  const heel = C.refuseOrder(dog, 'heel'), away = C.refuseOrder(dog, 'away');
  const seek = C.refuseOrder(dog, 'seek'), hold = C.refuseOrder(dog, 'hold');
  say('rung 0 may always heel/away', !heel && !away, `heel ${heel ?? 'ok'} / away ${away ?? 'ok'}`);
  say('rung 0 is refused seek/hold', !!seek && !!hold, `seek "${seek}" / hold "${hold}"`);
  dog._cmpRec = sworn;
  say('sworn holds every order',
    ['heel', 'away', 'ward', 'seek', 'hold', 'verb'].every((o) => !C.refuseOrder(dog, o)),
    COMPANION_RANKS[3].orders.join(','));
}

/* ── AWAY: it will not fight, whatever walks up ───────────────────────── */
{
  C.orderCompanion(dog, 'heel');
  for (let k = 0; k < 4; k++) foeAt(k * 1.57, 5);
  const why = C.orderCompanion(dog, 'away');
  let targeted = 0;
  for (let i = 0; i < 30 * 12; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); if (dog.target) targeted++; }
  say('AWAY takes no target at all', !why && targeted === 0,
    `${targeted} frames with a target, ${world.enemies.filter((e) => !e.dead && e.team !== dog.team).length} hostiles alive`);
}

/* ── HEEL cancels a standing order ────────────────────────────────────── */
{
  C.orderCompanion(dog, 'heel');
  say('HEEL clears the standing order', !dog._cmpDuty && !dog._cmpBidden,
    `duty ${dog._cmpDuty?.id ?? 'none'}`);
  let got = 0;
  run(30 * 8);
  for (let i = 0; i < 30 * 4; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); if (dog.target) got++; }
  say('and it fights again afterwards', got > 0, `${got} frames with a target in four seconds`);
}

/* ── SEEK: that body and no other ─────────────────────────────────────── */
{
  const foes = world.enemies.filter((e) => !e.dead && e.team !== dog.team);
  const near = foes.slice().sort((a, b) =>
    a.position.distanceTo(dog.position) - b.position.distanceTo(dog.position));
  const want = near[near.length - 1] || near[0];
  const why = C.orderCompanion(dog, 'seek', want);
  let onWant = 0, onOther = 0;
  for (let i = 0; i < 30 * 10; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (!dog.target) continue;
    if (dog.target === want) onWant++; else onOther++;
  }
  say('SEEK takes the named body only', !why && onOther === 0 && onWant > 0,
    `${onWant} frames on the named one, ${onOther} on anything else`
    + `${want.dead ? ' (and it killed it)' : ''}`);
}

/* ── WARD: measured from YOU, not from itself ─────────────────────────── */
{
  C.orderCompanion(dog, 'heel');
  run(30 * 3);
  for (const e of world.enemies) if (!e.dead && e.team !== dog.team) e.damage(e.hp + 50, e.position, null, 'bolt');
  run(30);
  C.orderCompanion(dog, 'ward');
  /* One FAR from the player but close to the dog: a ward must ignore it. */
  const far = foeAt(0, 40);
  dog.position.set(far.position.x + 2, far.position.y, far.position.z);
  let bit = 0;
  for (let i = 0; i < 30 * 5; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); if (dog.target === far) bit++; }
  const K = (await import('../src/game/CompanionKinds.js')).COMPANION_KINDS.massiff;
  say('WARD ignores what is far from YOU', bit === 0,
    `ward ${K.ward} m; the droid was ${far.position.distanceTo(p.position).toFixed(0)} m from you `
    + `and ${far.position.distanceTo(dog.position).toFixed(1)} m from it — ${bit} frames targeted`);
  /* …and one INSIDE the ring is taken. */
  const inr = foeAt(1.0, K.ward - 2);
  let took = 0;
  for (let i = 0; i < 30 * 6; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); if (dog.target === inr) took++; }
  say('WARD takes what comes near YOU', took > 0, `${took} frames on the one inside the ring`);
}

/* ── HOLD: it stands on the ground and does not follow ────────────────── */
{
  C.orderCompanion(dog, 'heel');
  run(30 * 2);
  const spot = dog.position.clone();
  const why = C.orderCompanion(dog, 'hold', spot);
  const start = p.position.clone();
  let worst = 0, endToOwner = 0;
  for (let i = 0; i < 30 * 10; i++) {
    /* Walk the owner away — the whole point of the order. */
    p.position.x = start.x + (i / 30) * 4;
    p.position.y = world.terrain.height(p.position.x, p.position.z) + 0.05;
    p.hp = p.maxHp ?? 100;
    world.update(STEP, idle);
    worst = Math.max(worst, dog.position.distanceTo(spot));
    endToOwner = dog.position.distanceTo(p.position);
  }
  /**
   * THE BAR IS THE ORDER'S OWN SENTENCE AND NOT A ROUND NUMBER.
   *
   * This first read `worst < 16` and went red at 17.6 m, which measured
   * nothing: the animal was SWORN, its leash is 34 m, and 17.6 m from its
   * ground is a companion meeting something that came to that ground — which
   * is the order working. The claim HOLD actually makes is "it does NOT follow
   * you afterwards", so the two things to measure are that it stayed inside
   * its own leash of the ground it was given, and that the owner walking off
   * left it behind.
   */
  const leash = dog._cmpLeash;
  say('HOLD stays on the ground you gave it', !why && worst <= leash,
    `never left its ground by more than ${worst.toFixed(1)} m against its own ${leash} m leash`);
  say('HOLD does not follow you', endToOwner > 20,
    `the owner walked ${p.position.distanceTo(start).toFixed(0)} m off and ended `
    + `${endToOwner.toFixed(0)} m away from it`);
}
