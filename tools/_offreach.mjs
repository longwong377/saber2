import './dom-shim.mjs';
const { bootSet } = await import('./_setfight.mjs');
for (const id of ['staff', 'pair']) {
  for (const d of [0.9, 1.2, 1.5]) {
    const row = [];
    for (const a of [0, 0.8, 1.6, 2.4, 3.14, -0.8, -1.6, -2.4]) {
      const b = await bootSet(id);
      for (let i = 0; i < 240; i++) {
        if (i % 30 === 0) { b.clear(); b.dummy(a, d); }
        if (i % 6 === 0) b.swing();
        b.step(1);
      }
      const off = b.log.filter((e) => e.blade === 'off').length;
      row.push(`${(a * 57.3) | 0}°:${off}/${b.log.length}`);
      b.world.unload();
    }
    console.log(`${id} @${d}m  ${row.join('  ')}`);
  }
}
