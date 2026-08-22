/**
 * MODE AUDIT — what each of the eight modes actually composes, wave by wave,
 * through the mode's OWN director on a real World.
 *
 *   node --import ./tools/register.mjs tools/_modeaudit.mjs compose [--waves 60] [--seed 7] [--level colosseum]
 *
 * No opinions (HANDOFF §3): it prints signatures, it does not grade them. The
 * signature of a wave is `type*count` sorted, plus the conditions the wave
 * carries, plus the body count and the budget. Two modes whose signature lists
 * are equal over N waves are the same evening.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('needs ./tools/register.mjs'); process.exit(2); }

const args = process.argv.slice(2);
const CMD = args[0] || 'compose';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WAVES = parseInt(flag('waves', '60'), 10);
const SEED = parseInt(flag('seed', '7'), 10);
const LEVEL = flag('level', 'colosseum');

const H = await import('./checks/_coop.mjs');
const { MODES, seedWaves, spawnType, spawnMod } = await import('../src/game/Waves.js');
const { enemyRng } = await import('../src/game/Enemy.js');

function sig(d) {
  const n = new Map();
  for (const e of d.spawnQueue) {
    const k = spawnType(e) + (spawnMod(e) ? `[${spawnMod(e)}]` : '');
    n.set(k, (n.get(k) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}*${v}`).join(' ');
}

async function composeMode(mode, level) {
  enemyRng.seed(SEED); seedWaves(SEED, 0);
  const { world } = await H.bootWorld({ level, spawn: false,
    settings: { quality: 'low', difficulty: 'knight', mode, level } });
  const d = world.director;
  const rows = [];
  for (let w = 1; w <= WAVES; w++) {
    try { d.start(w); } catch (e) { rows.push({ w, err: e.message }); continue; }
    rows.push({ w: d.wave, n: d.spawnQueue.length, sig: sig(d),
      cond: (d.conditions || []).join('+'),
      budget: d.budgetFor ? +d.budgetFor(d.wave).toFixed(1) : null });
  }
  const kind = d.constructor.name;
  world.dispose?.();
  return { mode, kind, rows };
}

if (CMD === 'compose') {
  const out = {};
  for (const mode of Object.keys(MODES)) {
    const lvl = MODES[mode].level || LEVEL;
    try { out[mode] = await composeMode(mode, lvl); }
    catch (e) { out[mode] = { mode, err: e.message }; }
  }
  for (const m of Object.keys(out)) {
    const r = out[m];
    if (r.err) { console.log(`${m.padEnd(10)} ERROR ${r.err}`); continue; }
    const sigs = r.rows.map(x => x.sig);
    const distinct = new Set(sigs).size;
    // longest run of identical consecutive signatures
    let run = 1, best = 1, at = 1;
    for (let i = 1; i < sigs.length; i++) {
      if (sigs[i] === sigs[i - 1]) { run++; if (run > best) { best = run; at = i - run + 2; } } else run = 1;
    }
    console.log(`${m.padEnd(10)} ${r.kind.padEnd(16)} distinct=${String(distinct).padStart(3)}/${sigs.length}`
      + ` longestPlateau=${String(best).padStart(3)} from w${at}`
      + `  bodies ${Math.min(...r.rows.map(x => x.n))}..${Math.max(...r.rows.map(x => x.n))}`);
  }
  // pairwise identity
  console.log('\npairwise identical waves (out of ' + WAVES + '):');
  const keys = Object.keys(out).filter(m => !out[m].err);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = out[keys[i]].rows, b = out[keys[j]].rows;
    let same = 0;
    for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k].sig === b[k].sig && a[k].cond === b[k].cond) same++;
    if (same > 0) console.log(`  ${keys[i]} vs ${keys[j]}: ${same}/${Math.min(a.length, b.length)}`);
  }
  const dump = flag('dump', null);
  if (dump) {
    const rows = out[dump]?.rows || [];
    for (const r of rows) console.log(`  w${String(r.w).padStart(3)} n=${String(r.n).padStart(3)} ${r.cond ? '['+r.cond+'] ' : ''}${r.sig}`);
  }
}

/* ── drive ────────────────────────────────────────────────────────────
 * Drive one mode to an ENDING with the scripted Jedi, and print what the
 * player is told on the way and at the end.
 *
 *   node --import ./tools/register.mjs tools/_modeaudit.mjs drive --mode skirmish [--cap 2400]
 */
if (CMD === 'drive') {
  const { dutyInput, drive } = await import('./_flagship.mjs');
  const mode = flag('mode', 'skirmish');
  const CAP = parseFloat(flag('cap', '2400'));
  const { theatreFor } = await import('../src/game/Levels.js');
  const lvl = theatreFor(mode, LEVEL, SEED);
  enemyRng.seed(SEED); seedWaves(SEED, 0);
  const { world } = await H.bootWorld({ level: lvl, runSeed: SEED,
    settings: { quality: 'low', difficulty: 'knight', mode, level: lvl } });
  const said = [];
  const baseNotify = world.notify?.bind(world);
  world.notify = (a, b) => { said.push([+world.time.toFixed(1), String(a), String(b ?? '')]); return baseNotify?.(a, b); };
  let ending = null;
  world.onGameOver = (s) => { if (!ending) ending = { t: +world.time.toFixed(1), ...s }; };
  const input = dutyInput(world);
  if (!MODES[mode]?.battles && !MODES[mode]?.picksCampaign) world.director.start?.(1);
  const t = drive(world, CAP, input, () => !!ending);
  console.log(`mode=${mode} level=${lvl} seed=${SEED}`);
  console.log(`  drove ${t.toFixed(0)} game-s; over=${world.over} wave=${world.director?.wave}`
    + ` score=${Math.floor(world.score)} kills=${world.players.reduce((a,p)=>a+(p.kills||0),0)}`);
  console.log(`  ending=${ending ? JSON.stringify(ending) : 'NONE'}`);
  console.log(`  boons=${[...(world.takenBoons||[])].join(',') || '(none)'}`);
  console.log(`  insight=${world.communion?.insight} bought=${(world.communion?.bought||[]).join(',')||'(none)'}`);
  console.log(`  support effort=${world.support?.effort?.toFixed?.(1)} release=${world.support?.release}`);
  console.log('  said:');
  for (const [tt, a, b] of said) console.log(`    ${String(tt).padStart(7)}  ${a}${b ? ' — ' + b : ''}`);
}
