/* SCRATCH PROBE — runs-to-WARD/SEEK in a mode with no ground. Delete me. */
import './dom-shim.mjs';
const STEP = 1 / 30;

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const K = await import('../src/game/CompanionKinds.js');

async function run(waves, { legacy = false, ordinary = false } = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
    runSeed: 21,
  });
  const input = idleInput(), p = world.player;
  const d = world.director;
  if (legacy) Object.defineProperty(d, 'wavesTaken', { get() { return 0; }, configurable: true });
  const tick = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); } };
  tick(30);
  const rec = { id: 'w', kind: 'massiff', name: 'B', xp: 0, runs: 0, areas: 0, kills: 0,
    saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] };
  const e = C.fieldCompanion(world, p, 'massiff', { rec });
  const curve = [];
  let ward = null, seek = null, sworn = null;
  for (let w = 1; w <= waves; w++) {
    /* A FIGHT PUTS GROUND BETWEEN THE ANIMAL AND ITS STATION, and an order it
     * is already obeying is not an order that landed. Displaced by hand here
     * so the deed has something to close, which is what a wave of shooting
     * does on its own. */
    if (!ordinary) { const st = new (world.player.position.constructor)();
      C.stationFor(e, st); e.position.set(st.x + 9, e.position.y, st.z + 9); }
    C.orderCompanion(e, 'away');
    tick(30 * 4);
    d.wave = (d.wave | 0) + 1;
    d.payWave(d.wave);
    tick(2);
    curve.push(`${w}:${rec.xp}`);
    const r = K.rungOf(rec).id;
    if (!ward && K.holdsCompanion(rec, 'ward')) ward = w;
    if (!seek && K.holdsCompanion(rec, 'seek')) seek = w;
    if (!sworn && r === 'sworn') sworn = w;
  }
  world.unload();
  return { xp: rec.xp, ward, seek, sworn, curve: curve.join(' '), orders: rec.orders, areas: rec.areas };
}

console.log('LEGACY  area-only  :', JSON.stringify(await run(20, { legacy: true })));
console.log('LEGACY  ordinary   :', JSON.stringify(await run(20, { legacy: true, ordinary: true })));
console.log('NOW     flawless   :', JSON.stringify(await run(20)));
console.log('NOW     ordinary   :', JSON.stringify(await run(20, { ordinary: true })));
