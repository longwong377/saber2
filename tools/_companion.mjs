/**
 * THE COMPANION KILL TEST — five measurements, taken before the expensive part.
 *
 * Skirmish on Geonosis, chosen deliberately: it is a mode whose World builds a
 * CommandDirector only if the levy slider is up, and the whole architectural
 * bet is that a companion finds enemies WITHOUT one.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { fieldCompanion, HEEL, LEASH } = await import('../src/game/Companions.js');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis',
  /* TRIAL OF WAVES: no `battles`, no `crossing`, allies 0 — so World builds NO
   * CommandDirector at all. This is the case the whole architecture is a bet
   * on, and the case every design that widened World.pickTarget would fail. */
  settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
  runSeed: 7,
});
const STEP = 1 / 30;
const p = world.player;
for (let i = 0; i < 30; i++) world.update(STEP, idle);
console.log('director present?', !!world.command, '  (the whole bet is that this does not matter)');

const dog = fieldCompanion(world, p, 'massiff');
if (!dog) { console.log('FAILED TO FIELD'); process.exit(1); }
console.log('fielded:', dog.id, dog.A.label, 'team', dog.team, 'vs player team', p.team);

/* WHAT IT DEALS, not only what it is credited with. A kill counted off a
 * world callback is a measurement of the callback; damage counted at the
 * receiving body is a measurement of the animal. */
const dealt = { n: 0, dmg: 0, closest: Infinity, kills: 0 };
const watchFoe = (e) => {
  if (!e || e._cmpWatched) return e;
  e._cmpWatched = true;
  const d0 = e.damage.bind(e);
  e.damage = (amount, point, source, kind) => {
    if (source === dog && amount > 0) { dealt.n++; dealt.dmg += amount; }
    const was = e.dead;
    const r = d0(amount, point, source, kind);
    if (!was && e.dead && source === dog) dealt.kills++;
    return r;
  };
  return e;
};
/* SOMETHING TO FIGHT. Trial of Waves fielded nothing at all in sixty seconds
 * on this seed, so the first run of this test measured an empty field and
 * reported 0% engagement as if it were an architectural failure. Hostiles are
 * put down by hand, near the player, and topped up as they die. */
const foeAt = (ang, r) => {
  const x = p.position.x + Math.sin(ang) * r, z = p.position.z + Math.cos(ang) * r;
  const v = new THREE.Vector3(x, world.terrain.height(x, z), z);
  const e = watchFoe(world.spawnEnemy('b1', v));
  if (e) e.team = 1;
  return e;
};
for (let k = 0; k < 4; k++) foeAt(k * 1.57, 9);

let frames = 0, near = 0, tooClose = 0, closeRun = 0, worstRun = 0;
let idleWithFoe = 0, everTargeted = 0, engaged = 0, onLeash = 0;
let maxDist = 0;
const damageToMine = { count: 0 };
// WHAT IS HITTING IT, and from how far.
const hits = new Map();
let firstHitAt = null;
const dmg0 = dog.damage.bind(dog);
dog.damage = (amount, point, source, kind) => {
  if (amount > 0) {
    const who = source ? (source.A?.label || source.constructor?.name || 'unknown') : `(no source: ${kind})`;
    const d = source?.position ? source.position.distanceTo(dog.position) : -1;
    const rec = hits.get(who) || { n: 0, dmg: 0, far: 0 };
    rec.n++; rec.dmg += amount; rec.far = Math.max(rec.far, d);
    hits.set(who, rec);
    if (firstHitAt === null) firstHitAt = frames;
  }
  return dmg0(amount, point, source, kind);
};
const kin = world.onEnemyKilled?.bind(world);
world.onEnemyKilled = (e, src, kind, ...r) => {
  if (src === dog) damageToMine.count++;
  return kin ? kin(e, src, kind, ...r) : undefined;
};

for (let i = 0; i < 30 * 60; i++) {
  /* Walk the player about so the follow is measured against movement, not a statue. */
  const t = i / 30;
  /* A WALK, NOT A TELEPORT — 0.20 rad/s on a 14 m circle is 2.8 m/s, which is
   * a person moving, and it is well under the companion's own 5.2 so the
   * follow is being measured rather than the leash. */
  p.position.x = Math.sin(t * 0.20) * 14;
  p.position.z = Math.cos(t * 0.20) * 14;
  p.position.y = world.terrain.height(p.position.x, p.position.z) + 0.05;
  p.aimDir.set(Math.cos(t * 0.3), 0, Math.sin(t * 0.3)).normalize();
  /**
   * THE PLAYER DOES NOT DIE IN A TEST OF THE FOLLOW, and the first run of this
   * measured what happens when he does.
   *
   * Four B1s put down beside him and an input that never blocks or dodges took
   * him from 100 to 0 in twenty-four seconds, and the remaining thirty-six
   * seconds of the minute were a companion heeling to a corpse — a frozen
   * station, no wish, 0.000 m of movement a frame. It reported as a 33.7 m
   * drag against an 8 m leash and 35% follow, and NONE of it was the leash.
   * (It was a real hole all the same, and `installCompanionMove` now stands
   * the animal over a fallen owner rather than freezing it; this line is so
   * that the four measurements below are about the follow.)
   */
  p.hp = p.maxHp ?? 100;
  world.update(STEP, idle);
  if (dog.dead) break;
  frames++;
  /* Keep four of theirs on the field so the engagement measure has a subject
   * for the whole minute rather than for the first ten seconds. */
  if (i % 90 === 0 && i < 30 * 30) {
    const dd = dog.position.distanceTo(p.position);
    const home = dog._cmpHome ? dog.position.distanceTo(dog._cmpHome) : -1;
    console.log(`  t=${(i/30).toFixed(0).padStart(2)}s  toPlayer ${dd.toFixed(1).padStart(5)}  toStation ${home.toFixed(1).padStart(5)}`
      + `  target ${dog.target ? (dog.target.A?.label||'?') : '-'}  wish ${dog.wish ? dog.wish.toArray().map(n=>n.toFixed(2)).join(',') : 'null'}`
      + `  speed ${(dog.speed||0).toFixed(1)}`);
  }
  if (i % 60 === 0) {
    const live = world.enemies.filter((e) => !e.dead && e.team !== dog.team).length;
    for (let k = live; k < 4; k++) foeAt(Math.random() * 6.28, 9 + Math.random() * 4);
  }
  const d = dog.position.distanceTo(p.position);
  if (dog.target && !dog.target.dead) {
    dealt.closest = Math.min(dealt.closest, dog.position.distanceTo(dog.target.position));
  }
  maxDist = Math.max(maxDist, d);
  /* WHAT "FOLLOWS" ACTUALLY MEANS. This counted frames inside 6 m of the
   * player against an 85% bar, which is a measure of a companion that never
   * fights: with the leash at 14 the animal is SUPPOSED to be out at fifteen
   * metres taking the droid that is shooting at you. The two things that can
   * go wrong are being LOST — outside the rule it was given — and being
   * UNDERFOOT, and those are the two numbers below. */
  if (d <= 6) near++;
  if (dog._cmpHome && dog.position.distanceTo(dog._cmpHome) <= (dog._cmpLeash ?? LEASH) + 0.5) onLeash++;
  if (d < 1.2) { closeRun += STEP; worstRun = Math.max(worstRun, closeRun); tooClose++; } else closeRun = 0;
  if (dog.target && !dog.target.dead) { everTargeted++; if (d < 30) engaged++; }
  else {
    /* AGAINST THE RULE THE ANIMAL IS ACTUALLY GIVEN, not a round number.
     * This read 20 m while the leash was 8, so every hostile between the two
     * counted as an animal ignoring a fight it was never allowed to take. */
    const home = dog._cmpHome || p.position;
    const foe = world.enemies.find((e) => !e.dead && e.team !== dog.team
      && e.position.distanceTo(home) < (dog._cmpLeash ?? LEASH));
    if (foe && !dog.wish) idleWithFoe++;
  }
}

const pct = (n) => `${(100 * n / Math.max(1, frames)).toFixed(1)}%`;
{
  const foes = world.enemies.filter((e)=>!e.dead && e.team!==dog.team);
  const near20 = foes.filter((e)=>e.position.distanceTo(p.position)<20).length;
  const near40 = foes.filter((e)=>e.position.distanceTo(p.position)<40).length;
  console.log(`\nFIELD AT THE END: ${foes.length} hostiles alive, ${near20} within 20 m of the player, ${near40} within 40`);
  const d = foes.map((e)=>e.position.distanceTo(dog.position)).sort((a,b)=>a-b)[0];
  console.log(`   nearest hostile to the dog: ${d===undefined?'none':d.toFixed(1)+' m'}   dog leash ${dog._cmpLeash}`);
}
console.log('\n1. FINDS ENEMIES WITH NO ARMY');
console.log(`   frames with a live target: ${pct(everTargeted)}   idle with a hostile inside its own leash: ${idleWithFoe} frames`);
console.log('\n2. FOLLOWS WITHOUT BEING A NUISANCE');
console.log(`   never lost — frames inside its own leash of its station: ${pct(onLeash)}`);
console.log(`   never underfoot — worst continuous run inside 1.2 m of you: ${worstRun.toFixed(2)} s`);
console.log(`   (frames inside 6 m of you: ${pct(near)}, furthest from you: ${maxDist.toFixed(1)} m — it is out fighting, which is the job)`);
console.log('\n3. IT IS SLOWER THAN YOU');
console.log(`   its speed ${dog.A.speed} vs your sprint — furthest it was dragged ${maxDist.toFixed(1)} m against a ${LEASH} m leash`);
console.log('\n4. IT FIGHTS FOR YOU');
console.log(`   damage it dealt: ${dealt.dmg.toFixed(0)} over ${dealt.n} blows, ${dealt.kills} kills (world credit ${damageToMine.count}), closest it got to a target ${dealt.closest === Infinity ? 'never had one' : dealt.closest.toFixed(1) + ' m'}\n   hp left ${Math.round(dog.hp)}/${dog.maxHp}`);
console.log('\nWHAT HIT IT (first hit at frame ' + firstHitAt + ')');
for (const [k, v] of [...hits.entries()].sort((a,b)=>b[1].dmg-a[1].dmg)) {
  console.log(`   ${k.padEnd(26)} ${String(v.n).padStart(4)} hits  ${v.dmg.toFixed(0).padStart(6)} dmg  furthest ${v.far.toFixed(1)} m`);
}
console.log('\n5. IT IS NOT ON THE ROLL');
console.log(`   trooper? ${!!dog.trooper}   commandOf? ${!!dog.commandOf}   in world.enemies? ${world.enemies.includes(dog)}`);
console.log(`   alive after 60 s: ${!dog.dead}`);
