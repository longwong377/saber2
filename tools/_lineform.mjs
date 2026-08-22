/**
 * WHY DOES THE LINE COME APART?
 *
 * Reported by the presence lane: 19.7% of living men inside MORALE.NEAR, and
 * the median man goes 12.6 m -> 45.7 m in thirty seconds. This measures where
 * each man is against THREE reference points every frame — the player, the
 * commander's formation anchor, and the slot the formation asked him to stand
 * in — so the answer separates "the anchor ran away" from "the man left it".
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { MORALE } = await import('../src/game/Morale.js');
const { dutyInput } = await import('./_flagship.mjs');
const STEP = 1 / 30;
const mode = process.argv[2] || 'theline';
for (const seed of (process.argv[3] || '1,2').split(',').map(Number)) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode, level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.start(1);
  const input = process.argv[4] === 'idle' ? H.idleInput() : dutyInput(world);
  const rows = [];
  for (let i = 0; i < 120 / STEP; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    /* `input.tick(STEP)` BEFORE the step, and this line is the whole bench.
     * `dutyInput` is a script whose entire body is `tick(dt)` — it reads the
     * world there, points the move axis, presses the swing and holds station.
     * `world.update` does not call it; `_flagship.mjs`'s own `drive` does, one
     * line above its step. A loop that steps without ticking has an unkillable
     * STATUE on the deploy mark, not a Jedi, and every number it takes is a
     * number about a sitting nobody would play. Three benches in three lanes
     * had this same omission on the same afternoon. */
    input.tick?.(STEP);
    world.update(STEP, input);
    if (i % 150 !== 0) continue;
    const p = world.player.position;
    const c = d.commander;
    const anch = c?._paceAnchor || c?.anchor || p;
    const dp = [], da = [], ds = [];
    for (const t of d.roster.living) {
      const b = t.body; if (!b || b.dead) continue;
      dp.push(Math.hypot(b.position.x - p.x, b.position.z - p.z));
      da.push(Math.hypot(b.position.x - anch.x, b.position.z - anch.z));
      const s = t.slot || b.formationSlot || b.slot || null;
      if (s) ds.push(Math.hypot(b.position.x - s.x, b.position.z - s.z));
    }
    if (!dp.length) break;
    const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    const mx = (a) => Math.max(...a);
    rows.push({ t: (i * STEP) | 0, n: dp.length,
      p: med(dp), a: med(da), s: ds.length ? med(ds) : null, max: mx(dp),
      near: dp.filter((v) => v <= MORALE.NEAR).length,
      anchorRun: Math.hypot(anch.x - p.x, anch.z - p.z) });
  }
  console.log(`seed ${seed} (NEAR=${MORALE.NEAR} m)`);
  for (const r of rows) {
    console.log(`  ${String(r.t).padStart(3)}s  n=${r.n}  median from player ${r.p.toFixed(1)} m  `
      + `max ${r.max.toFixed(1)} m  `
      + `inside NEAR ${r.near}/${r.n}  anchor is ${r.anchorRun.toFixed(1)} m from the player`);
  }
  world.unload();
}
