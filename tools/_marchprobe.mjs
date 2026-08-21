/**
 * DOES THE MODE'S MARCHING FRONT LAND ON THE GENERATED LINE?
 *
 *   node --import ./tools/register.mjs tools/_marchprobe.mjs <level> <seed>
 *
 * `battlefield.9` measures the dressing against a plan built by hand. This
 * boots the real mode, spies on `Terrain.scorch` and `Terrain.crater` while
 * `CommandDirector.start` marches engagement 1, and asks three things of the
 * marks that actually landed: what fraction is on the burnt side of the front
 * that drew them, how many are under the level's own water sheet, and whether
 * the line is still standing twenty seconds later.
 *
 * Both of the last two defects in this system were invisible to the bench and
 * obvious here: 352 of 352 burn marks under the Ember Shelf's lava, because
 * §14's schedule is measured from the player and the shelf is built around the
 * plan; and 38% of a swath on the clean side of its own front, because a curve
 * carried along its own normal is a parallel curve and not a rigid copy.
 */
import './dom-shim.mjs';
const STEP = 1 / 30;
const LEVEL = process.argv[2] || 'scoria';
const SEED = Number(process.argv[3] ?? 3);
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { world } = await bootWorld({ level: LEVEL, spawn: true,
  settings: { mode: 'theline', level: LEVEL, order: 'jedi' }, runSeed: SEED });
const d = world.command;
const plan = world.battlefield;
console.log(`${LEVEL} seed ${SEED}: plan ${plan ? plan.reason : 'NONE'} choke ${plan ? `${plan.choke.x.toFixed(0)},${plan.choke.z.toFixed(0)}` : '-'}`);
const marks = [];
const real = world.terrain.scorch.bind(world.terrain);
world.terrain.scorch = (x, z, r, a) => { marks.push([x, z]); return real(x, z, r, a); };
const holes = [];
const realC = world.terrain.crater.bind(world.terrain);
world.terrain.crater = (x, z, r, dd) => { holes.push([x, z]); return realC(x, z, r, dd); };
d.start(1);
world.terrain.scorch = real; world.terrain.crater = realC;
console.log(`  marched=${d._marched} burns=${marks.length} craters=${holes.length}`);
if (plan && marks.length) {
  const { frontLine, frontAtChoke, FRONT_MARCH } = await import('../src/world/Battlefield.js');
  const line = frontLine({ ...frontAtChoke(plan, 1), offset: FRONT_MARCH });
  const rel = marks.map(([x, z]) => line.side(x, z).d);
  const on = rel.filter((v) => v > -6.5).length;
  console.log(`  burnt-side fraction at engagement 1: ${(100 * on / rel.length).toFixed(1)}%  (offset ${FRONT_MARCH} m, plan.distance ${plan.distance.toFixed(0)} m)`);
  const sorted = [...rel].sort((a, b) => a - b);
  console.log(`  signed distance to the engagement-1 line: min ${sorted[0].toFixed(1)} p25 ${sorted[sorted.length >> 2].toFixed(1)} med ${sorted[sorted.length >> 1].toFixed(1)} max ${sorted[sorted.length - 1].toFixed(1)}`);
  const wet = marks.filter(([x, z]) => world.terrain.height(x, z) < (world.level?.water?.level ?? -999)).length;
  console.log(`  marks laid under the sheet: ${wet} of ${marks.length}`);
}
const up = d.roster.living.filter((t) => t.body && !t.body.dead).length;
const input = idleInput();
for (let i = 0; i < Math.round(20 / STEP); i++) world.update(STEP, input);
console.log(`  ${d.roster.living.filter((t) => t.body && !t.body.dead).length}/10 standing after 20 s (was ${up} at deploy)`);
world.unload();
