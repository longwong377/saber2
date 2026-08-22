/**
 * WHY DOES A LINE FAIL TO DEPLOY? — the clause that refused, not the count.
 *
 *   node --import ./tools/register.mjs tools/_deployattr.mjs <level> <seed> [gen|authored]
 *
 * `CommandDirector._standingRoom` walks a widening ring and gives up; what it
 * reports is a number of unplaced men, which is the same number whatever
 * refused them. This re-walks the same ring and attributes every candidate
 * point to the clause that would reject it — the water sheet, a static box, the
 * commander's blade, or the edge of the map — and then drives twenty seconds of
 * a real engagement so the attribution can be read beside the outcome.
 *
 * It is the instrument that settled the Ember Shelf. The recorded cause was
 * "scoria's rocks and wrecks take the standing room with them"; measured, at
 * seed 3 on a generated ground, static boxes refuse 10 of 288 points against
 * the authored ground's 3 — and the lava refuses 126.
 *
 * IT RE-DERIVES THE CLAUSES rather than calling `placementClear`, which is
 * HANDOFF §2.4's defect on purpose and the only way to get an attribution out
 * of a function that returns a boolean. Keep the two in step: if `spawnClear`
 * grows a clause, this reports a rejection it cannot name.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const STEP = 1 / 30;
const LEVEL = process.argv[2] || 'scoria';
const SEED = Number(process.argv[3] ?? 3);
const GEN = process.argv[4] !== 'authored';

const { LEVELS } = await import('../src/game/Levels.js');
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const Spawn = await import('../src/game/Spawn.js');

const L = LEVELS[LEVEL];
const was = L.battlefield;
if (GEN) L.battlefield = true;

const { world } = await bootWorld({
  level: LEVEL, spawn: true,
  settings: { mode: 'theline', level: LEVEL, order: 'jedi' },
  runSeed: SEED,
});
const d = world.command;

/* The same ring `_standingRoom` walks — `DEPLOY_TRIES` rings at `DEPLOY_WIDEN`
 * — sampled at every bearing and attributed to the first clause that refuses. */
function attribute(w, anchor) {
  const out = { n: 0, wet: 0, box: 0, blade: 0, oob: 0, ok: 0 };
  const wat = w.level?.water;
  for (let k = 0; k < 6; k++) {
    for (let a = 0; a < 48; a++) {
      const ang = a / 48 * Math.PI * 2;
      const r = 4 + (a % 3) * 2.2 + k * 2.9;
      const x = anchor.x + Math.sin(ang) * r, z = anchor.z + Math.cos(ang) * r;
      out.n++;
      if (!w.terrain.inBounds(x, z, 8)) { out.oob++; continue; }
      const y = w.terrain.height(x, z);
      let bad = false;
      if (wat) {
        const depth = (wat.level ?? 0) - y;
        if (depth > 0 && (wat.damage > 0 || depth > Math.min(wat.wade ?? 0.45, 0.45))) { out.wet++; bad = true; }
      }
      if (!bad && !Spawn.spawnClear(w, x, y, z)) { out.box++; bad = true; }
      if (!bad && !Spawn.bladeClear(w, x, z)) { out.blade++; bad = true; }
      if (!bad) out.ok++;
    }
  }
  return out;
}

d.start(1);
const anchor = d.commanders[0]?.anchor || world.player?.position || { x: 0, z: 0 };
console.log(`${LEVEL} seed ${SEED} ${GEN ? 'GENERATED' : 'authored'} · anchor ${anchor.x.toFixed(1)},${anchor.z.toFixed(1)} h=${world.terrain.height(anchor.x, anchor.z).toFixed(2)} water=${world.level?.water?.level ?? 'none'} dmg=${world.level?.water?.damage ?? 0}`);
console.log('  ring attribution:', JSON.stringify(attribute(world, anchor)));

const input = idleInput();
for (let i = 0; i < Math.round(20 / STEP); i++) world.update(STEP, input);
const living = d.roster.living;
const up = living.filter((t) => t.body && !t.body.dead).length;
const nobody = living.filter((t) => !t.body).length;
console.log(`  after 20 s: ${up}/10 standing, ${nobody} never placed, roster living ${living.length}`);
/* Where are the bodies, and are they in the lava? */
const wat = world.level?.water;
let inLava = 0;
for (const t of d.roster.all) {
  if (!t.body) continue;
  const p = t.body.position;
  if (wat && world.terrain.height(p.x, p.z) < (wat.level ?? 0)) inLava++;
}
console.log(`  bodies standing on ground below the waterline: ${inLava}`);
const hostile = (world.enemies || []).filter((e) => e && !e.dead && e.team !== (world.partyTeam ?? 0)).length;
console.log(`  hostiles on the field: ${hostile} (of ${(world.enemies || []).length} bodies)`);
world.unload();
L.battlefield = was;
