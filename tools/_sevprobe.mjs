/** Scratch: what each machine's severable set looks like to the One Point. */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');

const KINDS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['b1', 'b2', 'tridroid', 'dwarfspider', 'droideka', 'trooper'];

for (const kind of KINDS) {
  const { world } = await bootWorld({});
  try {
    const p = world.player;
    p.saber.lit = false;
    p.force = p.maxForce ?? 100; p.stamina = p.maxStamina ?? 100;
    p.boonMods.meleePoint = 1;
    p.camera.yaw = 0; p.camera.pitch = 0;
    const at = p.position.clone(); at.z -= 1.6;
    const e = world.spawnEnemy(kind, at);
    if (!e) { console.log(`${kind}: no body`); continue; }
    e.noReact = true;
    const centre = p._enemyPoint(e, new THREE.Vector3()).clone();
    const caps = e.capsules ? e.capsules() : [];
    const live = p._severable(e, centre);
    console.log(`\n=== ${kind}  hp ${e.hp}  actor=${!!e.actor} rig=${!!e.rig} custom=${e.A.custom}`);
    console.log(`  capsules ${caps.length}: ` + caps.map(c => `${c.name}${c.cover?'(cover)':''}${c.covers?'[gap]':''}=${c.vital}`).join(' '));
    console.log(`  severable ${live.length}: ` + live.map(c => c.name).join(' '));
    console.log(`  budget ${p._severBudget(p.forceScale)}`);
    // now drive the real strike
    let cuts = [];
    const realDis = p.disassembleBody.bind(p);
    p.disassembleBody = (...a) => { const r = realDis(...a); cuts.push(r); return r; };
    const i = idleInput();
    i.act = (a) => a === 'stance';
    i.actHit = (a) => a === 'thrust';
    world.update(1 / 60, i);
    const idle = idleInput();
    for (let n = 0; n < 90 && p._melee.move; n++) { if (!e.dead) e.position.copy(at); world.update(1/60, idle); }
    console.log(`  RESULT parts=${e.actor?.severedCount ?? 0} limbsRemoved=${p.limbsRemoved} dead=${e.dead} hp=${e.hp.toFixed(0)} disassembleBody->${JSON.stringify(cuts)} legsLost=${e.legsLost ?? '-'} toppled=${!!e.toppled} toppleAt=${e.A.toppleAt}`);
    if (e.actor) console.log('  severed bones: ' + JSON.stringify([...(e.actor.severedNames ?? [])]));
  } finally { world.dispose?.(); }
}
