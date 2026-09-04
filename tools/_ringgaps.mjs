import './dom-shim.mjs';
const { PLACES, DRUM } = await import('../src/game/StationPlan.js');
for (const deck of [40, 44, 48]) {
  const blocked = [];
  for (const p of PLACES) {
    if (p.deck !== deck || p.external || !p.door) continue;
    const dr = Math.hypot(p.door[0], p.door[1]);
    if (dr < 79) continue;
    const pa = (Math.atan2(p.door[0], p.door[1]) * 180 / Math.PI + 360) % 360;
    const half = Math.atan2(p.w / 2, Math.hypot(p.x, p.z) || 1) * 180 / Math.PI;
    blocked.push([pa, half, `#${p.id} ${p.name}`]);
  }
  for (const d of DRUM.spines) blocked.push([d, 8, 'spine']);
  blocked.sort((a, b) => a[0] - b[0]);
  console.log(`── deck ${deck}`);
  for (const b of blocked) console.log(`   ${b[0].toFixed(0).padStart(3)}° ±${b[1].toFixed(1)}  ${(b[0]-b[1]).toFixed(0)}..${(b[0]+b[1]).toFixed(0)}  ${b[2]}`);
  // free arcs
  const free = [];
  for (let i = 0; i < blocked.length; i++) {
    const a = blocked[i], b = blocked[(i + 1) % blocked.length];
    const from = a[0] + a[1], to = (b[0] - b[1] + 360) % 360;
    let span = (to - from + 360) % 360;
    if (span > 0.5) free.push(`${from.toFixed(0)}..${(from + span).toFixed(0)} (${span.toFixed(0)}°)`);
  }
  console.log('   FREE: ' + free.join('  '));
}
