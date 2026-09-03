/**
 * WHAT EACH SET ACTUALLY BUYS AND PAYS — measured on a real player, because
 * the player's ask was specific: "there will be pluses and minuses to each",
 * "with dual wielding blocking bolts is easier or area that you can cover is
 * larger", "the double bladed user will have more reach", "two-tempo moves
 * because the second blade is instantly ready for a follow-up strike".
 */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { SABER_SETS, setById } = await import('../src/game/SaberSet.js');
const idle = idleInput();
const STEP = 1 / 30;
const rows = [];
for (const S of SABER_SETS) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', saberSet: S.id },
    runSeed: 5,
  });
  const p = world.player;
  for (let i = 0; i < 60; i++) world.update(STEP, idle);
  const blades = [p.saber, p.sidearm?.saber].filter(Boolean);
  /* REACH: the furthest point any of this set's blades can put a tip, from the
   * hilt the hand is on. A staff's far end is a whole blade beyond the grip. */
  const reach = Math.max(...blades.map((b) => b.base.distanceTo(b.tip)));
  const span = blades.length > 1
    ? blades[0].tip.distanceTo(blades[1].tip) : reach;
  /* THE ARC A GUARD COVERS. `setHalf` is the extra half-width the staff's rose
   * answers; the pair's second bearing is a second blade in a second place. */
  const half = p.control.setHalf ?? 0;
  rows.push({ id: S.id, blades: blades.length, reach, span, half,
    offScale: S.offScale, offDamage: S.offDamage, hands: S.hands, throwKey: S.throwKey });
  world.unload();
}
const base = rows[0];
for (const r of rows) {
  console.log(`${r.id.padEnd(7)} blades ${r.blades}  reach ${r.reach.toFixed(2)} m`
    + `  tip-to-tip ${r.span.toFixed(2)} m  extra guard half ${r.half.toFixed(3)} rad`
    + `  hands ${r.hands}  off ${(r.offScale * 100) | 0}% long / ${(r.offDamage * 100) | 0}% cut`
    + `  throw=${r.throwKey}`);
}
console.log('\nAGAINST ONE BLADE:');
for (const r of rows.slice(1)) {
  console.log(`  ${r.id}: reach ${((r.reach / base.reach - 1) * 100).toFixed(0)}%,`
    + ` covered span ${((r.span / base.span - 1) * 100).toFixed(0)}%,`
    + ` guard rose +${(r.half * 57.3).toFixed(1)}°,`
    + ` hands ${r.hands - base.hands}`);
}
