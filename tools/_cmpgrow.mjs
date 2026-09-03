/**
 * THE GROWTH LADDER, DRIVEN — the probe the gates were cut against.
 *
 * A real Grind (five engagements), a real animal, five real area boundaries
 * through the shipped `payWave → _areaClear` path, and an order landing, a
 * fall and a revive in every one of them. It prints the xp curve, where each
 * rung lands, and the ceiling of one crossing against the two clauses
 * `tools/checks/command.mjs:845` pins for the trooper ladder.
 *
 * The check in `tools/checks/companions.mjs` asserts what this prints. Run it
 * when you want to see the curve rather than a pass.
 */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const Kn = await import('../src/game/Kennel.js');
const K = await import('../src/game/CompanionKinds.js');
const S = await import('../src/game/Session.js');

const STEP = 1 / 30;
/* A GRIND AND NOT WHATEVER THE SEED ROLLS. `rollSession` rolls the length —
 * Raid 2, Push 3, Grind 5 — so a seed that rolled a Raid would measure a
 * two-area ceiling and report it as the game's. */
const SEED = 2;
console.log('session roll:', JSON.stringify(S.rollSession(SEED)));
const { world } = await bootWorld({
  level: 'geonosis',
  settings: { mode: 'command', level: 'geonosis', quality: 'low' },
  runSeed: SEED,
});
const input = idleInput();
const p = world.player;
const d = world.command;
console.log('stages:', d.stages.length, d.stages.map((s) => s.id).join(' → '));

const tick = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); } };
tick(30);

const rec = { id: 'probe', kind: 'massiff', name: 'Borz', xp: 0, runs: 0, areas: 0,
  kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] };
const e = C.fieldCompanion(world, p, 'massiff', { rec });
/* `_mayGoDown` opens `if (!this.trooper) return false` and a companion has no
 * trooper by design, so the window is entered through `_goDown` — the same
 * door the eligible path uses, with one refusal stepped over. */
console.log('fielded:', !!e, '· leash', C.leashOf(e), '· band', C.settledBand(e).toFixed(2),
  '· mayGoDown?', e._mayGoDown('bolt'));

for (let area = 0; area < d.stages.length && !world.over; area++) {
  const xp0 = rec.xp;
  C.orderCompanion(e, 'away');
  tick(30 * 4);

  e._goDown(e.position, { team: 1, position: e.position }, 'bolt');
  let up = null;
  for (let i = 0; i < 30 * 20 && up === null; i++) {
    p.position.set(e.position.x, e.position.y, e.position.z);
    p.hp = p.maxHp ?? 100;
    world.update(STEP, input);
    if (!e.downed && !e.dead) up = (i / 30).toFixed(1);
  }

  const gap = C.stationGap(e);
  d.areaWaves = d.area.waves - 1;
  d.wave = (d.wave | 0) + 1;          // payWave is a ledger: the number has to climb
  d.payWave(d.wave);
  tick(2);
  console.log(JSON.stringify({ area: area + 1, taken: d.areasTaken, gap: +gap.toFixed(1),
    leash: C.leashOf(e), upIn: up, gained: rec.xp - xp0, xp: rec.xp,
    rung: K.rungOf(rec).label, areas: rec.areas, downs: rec.downs, orders: rec.orders }));
}

const pack = world._companions;
console.log('ranged clocks: far', pack.farT.toFixed(1), 's · near', pack.nearT.toFixed(1),
  's → rangedRun', pack.rangedRun);
console.log('final:', JSON.stringify(rec));
console.log('earned tempers:', Kn.earnedTempers(rec).map((t) => t.id).join(',') || 'none');
console.log('gates:', K.COMPANION_RANKS.map((r) => `${r.label}@${r.xp}`).join(' '));

const n = d.stages.length;
const each = Kn.DEEDS.crossed + Kn.DEEDS.order + Kn.DEEDS.recovered;
const ceil = n * each;
const top = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1];
console.log(`one ${n}-area crossing, bankable deeds only: ${n} × ${each} = ${ceil}`);
console.log(`top gate ${top.xp} — reachable? ${top.xp <= ceil}`
  + ` · past the 40% floor of ${(ceil * 0.4).toFixed(0)}? ${top.xp > ceil * 0.4}`);
world.unload();
