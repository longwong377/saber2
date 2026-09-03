/**
 * WHAT THE LIFE LAYER ACTUALLY MOVES — one companion, measured bone by bone.
 *
 *   node --import ./tools/register.mjs tools/_cmplife.mjs [kind] [level]
 *
 * Sixty seconds a kind, the last forty of them with every hostile struck dead
 * on the frame it appears — because an idle beat only fires when nothing is
 * happening, and something is always happening in a wave.
 *
 * THE LEVEL DEFAULTS TO THE COLOSSEUM AND THAT IS NOT ARBITRARY — but the
 * reason this file used to give was too big. It said "on Geonosis a companion
 * at heel never settles". Re-measured, it is the PLAYER'S SPAWN POINT on
 * Geonosis and nowhere else on it: `fieldCompanion` drops the animal at
 * (0.00, 4.60) with its heel station 0.90 m away at (-0.90, 4.60), on the far
 * side of a static face whose normal points +X, and `Enemy._move`'s wall slide
 * walks a closed circuit round it — 64% of frames in wall contact, 3.76 m/s
 * mean, a 1.98 m mean gap against a 0.61 m band, and `_stuckT` never once over
 * 0.5 s because a body doing four metres a second is not stuck by its own
 * measure. Stand the player anywhere else on the same level, or start the
 * animal 0.4 m further back, and it settles at a 0.04 m gap and 0.000 m/s with
 * beats firing; walk 18 m off the spawn and the loop ends inside five seconds.
 * Colosseum floor: gap 0.07 m, speed 0.000, calm for 39.5 s of 40. Pass a
 * level to see it either way.
 */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { fieldCompanion } = await import('../src/game/Companions.js');

const STEP = 1 / 30;
const idle = idleInput();
const only = process.argv[2] || null;
const LV = process.argv[3] || 'colosseum';

for (const id of Object.keys(COMPANION_KINDS)) {
  if (only && id !== only) continue;
  const K = COMPANION_KINDS[id];
  if (!ARCHETYPES[K.archetype]) { console.log(`${id.padEnd(8)} NO ARCHETYPE`); continue; }
  const { world } = await bootWorld({
    level: LV,
    settings: { mode: 'waves', level: LV, allies: 0, quality: 'low' },
    runSeed: 11,
  });
  const p = world.player;
  for (let i = 0; i < 30; i++) world.update(STEP, idle);
  const e = fieldCompanion(world, p, id, { rec: { id: `r-${id}`, xp: 99 } });
  if (!e) { console.log(`${id.padEnd(8)} SPAWN REFUSED`); world.unload(); continue; }

  const head = e.rig?.get('head');
  const trunk = e.rig?.get('body');            // creature only — nothing else writes it
  const beats = new Set();
  let hMin = 9, hMax = -9, tMin = 9, tMax = -9, ribMin = 9, ribMax = -9, calmMax = 0;
  for (let i = 0; i < 30 * 60; i++) {
    p.hp = p.maxHp ?? 100;
    /* CALM after the first twenty seconds: nothing left to fight, nobody
     * shooting, and the player standing still. */
    if (i > 30 * 20) for (const o of world.enemies) if (o !== e && !o.dead) o.dead = true;
    world.update(STEP, idle);
    const L = e._life;
    if (L?.beat) beats.add(L.beat.id);
    if (L) calmMax = Math.max(calmMax, L.calm);
    if (head) {
      const a = head.obj.quaternion.angleTo(head.restQuat);
      hMin = Math.min(hMin, a); hMax = Math.max(hMax, a);
    }
    if (trunk) {
      const a = trunk.obj.quaternion.angleTo(trunk.restQuat);
      tMin = Math.min(tMin, a); tMax = Math.max(tMax, a);
    }
    const r = L?.parts?.ribs?.[0];
    if (r) { ribMin = Math.min(ribMin, r.mesh.scale.x); ribMax = Math.max(ribMax, r.mesh.scale.x); }
  }
  const L = e._life;
  console.log(`${id.padEnd(8)} head ${hMin.toFixed(3)}–${hMax.toFixed(3)}`
    + ` | trunk ${trunk ? `${tMin.toFixed(4)}–${tMax.toFixed(4)}` : '  —  '}`
    + ` | rib ${ribMin.toFixed(4)}–${ribMax.toFixed(4)}`
    + ` | ${L ? (L.breath * 60).toFixed(1) : '—'}/min`
    + ` | nerve ${L ? L.nerve.toFixed(2) : '—'} poise ${L ? L.poise.toFixed(2) : '—'}`
    + ` | calm ${calmMax.toFixed(1)}s`
    + ` | menu [${L ? L.menu.map((b) => b.id).join(',') : ''}]`
    + ` | fired [${[...beats].join(',')}]`);
  world.unload();
}
