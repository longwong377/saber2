/**
 * DOES THE DESECRATION ACTUALLY HAPPEN — the player's V13 addition, measured.
 *
 *   "make sure than desecrating enemy corpses actually works and that some of
 *    your troops actually pick up real dead enemy ragdolls and tear them
 *    apart/take off real limbs/heads"
 *
 * Four questions, in the order they can fail:
 *   1. does the order reach anybody, and how many
 *   2. do they walk to a REAL enemy corpse (a ragdoll on the field, not a mark)
 *   3. does a limb or a head actually come off it
 *   4. does the line get the frenzy it is paid for
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const idle = idleInput();
const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'command', level: 'geonosis', order: 'sith', allies: 14 }, runSeed: 4,
});
const d = world.command; d.start(1);
const c = d.commander; c.player = world.player;
const STEP = 1 / 30;
for (let i = 0; i < 60; i++) world.update(STEP, idle);

// Kill a dozen hostiles near the line so there is something to desecrate.
const mine = world.player.team ?? 0;
const foes = world.enemies.filter((e) => e.team !== mine && !e.dead).slice(0, 12);
for (const e of foes) {
  e.position.copy(world.player.position).add(new THREE.Vector3((Math.abs(e.id.charCodeAt(1) % 9) - 4) * 2.2, 0, 6 + (e.id.length % 5)));
  e.position.y = world.terrain.height(e.position.x, e.position.z);
  e.hp = 0; e.die?.(e.position.clone(), null, 'check');
  if (e.downed) e.die?.(e.position.clone(), null, 'check');
}
for (let i = 0; i < 45; i++) world.update(STEP, idle);
const corpses = world.corpses?.list || [];
console.log(`corpses on the field before the order: ${corpses.length}`);
const sever0 = corpses.reduce((n, x) => n + (x.e?.actor?.severedCount || 0), 0);

// count finishes per body
const fin = new Map();
const origFin = d._desecrateFinish.bind(d);
d._desecrateFinish = (c2, t2, e2, o2) => { fin.set(o2.id, (fin.get(o2.id) || 0) + 1); return origFin(c2, t2, e2, o2); };
d.order('desecrate', c);
let onIt = 0, ticks = 0, everHeld = 0, maxRend = 0;
for (let i = 0; i < 30 * 30; i++) {
  world.update(STEP, idle);
  const recs = (c.roster?.living || []).filter((t) => t.body && !t.body.dead);
  const n = recs.filter((t) => t.rending).length;
  if (n > onIt) onIt = n;
  if (n) ticks++;
  everHeld = Math.max(everHeld, recs.filter((t) => t._rentTarget).length);
  const fu = recs.filter((t) => (t.body.furyTimer || 0) > 0).length;
  if (fu > maxRend) maxRend = fu;
}
const sever1 = corpses.reduce((n, x) => n + (x.e?.actor?.severedCount || 0), 0);
const gone = corpses.filter((x) => x.e?.actor?.severedCount > 0).length;
console.log(`men detailed to rend at once: ${onIt}   frames with anybody detailed: ${ticks}   most holding a body: ${everHeld}`);
console.log(`severed pieces on those corpses: ${sever0} -> ${sever1}   bodies with a piece off: ${gone}/${corpses.length}`);
console.log(`most men in fury at once: ${maxRend}`);
// WHICH BONES CAME OFF — he named heads specifically.
const tally = new Map();
for (const x of corpses) {
  const rag = x.e?.actor?.ragdoll || x.e?.ragdoll;
  const list = rag?.bones || rag?.list || x.e?.rig?.list || [];
  for (const b of list) {
    if (b?.severed || b?.isSevered || b?.cut) tally.set(b.name, (tally.get(b.name) || 0) + 1);
  }
}
console.log('bones flagged severed:', [...tally.entries()].map(([k, v]) => `${k}x${v}`).join(' ') || '(none flagged — corpses sever as physics, see cutRagdoll)');
const cutT = (x, n) => x.e?.rig?.get?.(n)?.cutT ?? 1;
const heads = corpses.filter((x) => cutT(x, 'head') < 1).length;
console.log('finishes per body:', [...fin.entries()].map(([k,v])=>`${k}x${v}`).join(' ') || '(none)');
console.log('cutT per bone on worked bodies:');
for (const x of corpses.filter((y) => y.e?._rent)) {
  const names = ['head','foreL','foreR','shinL','shinR','armL','armR','thighL','thighR'];
  console.log('  ', x.e.id, names.map((n) => `${n}:${cutT(x, n).toFixed(2)}`).join(' '));
}
const worked = corpses.filter((x) => x.e?._rent).length;
console.log(`bodies worked: ${worked}/${corpses.length}   HEADS TAKEN: ${heads}`);
const one = corpses.find((x) => (x.e?.actor?.severedCount || 0) > 0);
if (one) {
  const a = one.e.actor;
  console.log('worked body:', one.e.id, 'severedCount', a.severedCount, '_rent', !!one.e._rent);
  const rag = a.ragdoll;
  if (rag) console.log('  ragdoll parts:', (rag.parts || rag.bodies || []).length, ' joints:', (rag.joints || []).length);
}
