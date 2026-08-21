/**
 * THE INVISIBLE WALL PROBE — the wood, after it has been cut down.
 *
 * "the forest map still has a shit ton of invisible walls blocking you, I think
 *  maybe only when you cut trees down"
 *
 * A wall is a static box with nothing drawn where it is. So this fells trees
 * through the shipped path, then walks every static box the tree system owns
 * and asks what is standing there — against the tree records themselves, which
 * are the only authority on what is drawn.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');

const { world } = await bootWorld({ level: 'wood', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const input = idleInput();
const trees = world.forest;
if (!trees) { console.log('no tree system on this level:', world.levelKey); process.exit(0); }
const { F } = await import('../src/world/Trees.js').then((m) => ({ F: m.F ?? null }));
console.log(`level ${world.levelKey}: ${trees.count} trees, ${world.physics.staticBoxes.length} static boxes at load`);

const P = world.player;
const N = Number(process.argv[2] || 60);
let felled = 0;
for (let i = 0; i < trees.count && felled < N; i++) {
  const before = trees.stats.felled;
  trees.fell(i, Math.cos(i) , Math.sin(i), 0.6);
  if (trees.stats.felled > before) felled++;
  for (let f = 0; f < 6; f++) world.update(1 / 30, input);
}
/* Let everything land, settle and hand over to whatever owns it next. */
for (let f = 0; f < 30 * 30; f++) world.update(1 / 30, input);

console.log(`felled ${felled} (stats: ${JSON.stringify(trees.stats)})`);
console.log(`down=${trees.down.size} live=${trees.live.size} logs=${trees.logs.size} real=${trees.real.size}`);
console.log(`static boxes now: ${world.physics.staticBoxes.length}`);

/* Every box the tree system is responsible for, and whether anything is there. */
const owned = new Map();
for (const [i, b] of trees.live) owned.set(b, `standing #${i}`);
for (const [i, arr] of trees.logs) for (const b of arr) owned.set(b, `log #${i}`);
for (const [i, r] of trees.real) if (r.box) owned.set(r.box, `prop #${i}`);
let orphan = 0;
for (const b of world.physics.staticBoxes) {
  if (!owned.has(b) && b.userData?.tree !== undefined) { orphan++; }
}
console.log(`tree boxes tracked: ${owned.size}; untracked boxes tagged as trees: ${orphan}`);

/* And the real question: a box standing where the drawing says there is nothing. */
let ghostWalls = 0;
const D = trees.data;
for (const [b, who] of owned) {
  const m = /#(\d+)/.exec(who);
  const i = m ? Number(m[1]) : -1;
  if (i < 0) continue;
  const standing = trees.live.has(i);
  const isDown = trees.down.has(i);
  const isReal = trees.real.has(i);
  if (who.startsWith('standing') && (isDown || isReal)) { ghostWalls++; console.log(`  WALL: ${who} but the tree is down`); }
  if (who.startsWith('log') && !isDown) { ghostWalls++; console.log(`  WALL: ${who} but it is not in the down set`); }
}
console.log(`mismatched colliders: ${ghostWalls}`);
