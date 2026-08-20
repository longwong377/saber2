/**
 * BATTLEFRONT BORZ — HOW OFTEN IS AN ALLY STANDING STILL DOING NOTHING?
 *
 *   node --import ./tools/register.mjs tools/_idle.mjs [--secs 60]
 *
 * The player: "your allies shouldn't just freeze in place when they're
 * uninspired or whatever … them frozen still looks like a bug almost".
 *
 * It asserts nothing. It drives a REAL World in Command mode on Geonosis with a
 * real army, and once per frame classifies every living allied body:
 *
 *   moving   horizontal speed >= 0.35 m/s
 *   firing   mid-burst, mid-telegraph, or a muzzle flash still alight
 *   idle     neither — a man standing in the open doing nothing
 *
 * FROZEN — the number the player is complaining about — is a body that is
 * motionless, not firing AND still upright. A man kneeling behind a rock is
 * still; a man standing to attention in the open is broken.
 *
 * Conditions: the five formations at natural morale, then the same field with
 * every record's morale forced to a broken value and to a refusing one, which
 * is the state the player is describing.
 */
import './dom-shim.mjs';
import { stubEngine, idleInput } from './checks/_coop.mjs';

/** A real World on a NAMED seed — the director is built inside `loadLevel`, so
 *  `runSeed` has to be on the world before that call or the run is unseeded. */
async function seededWorld(level, mode, seed) {
  const { World } = await import('../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
  const { initPhysics } = await import('../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../src/game/Combat.js');
  await initPhysics();
  const engine = await stubEngine();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', mode };
  const world = new World(engine, s);
  world.runSeed = seed;
  world.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
  await world.loadLevel(level);
  world.spawnPlayer({ name: 'Jedi', isLocal: true });
  return world;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : Number(process.argv[i + 1]); };
const SECS = arg('--secs', 30);
const DT = 1 / 30;

const streak = new Map();   // body id -> current frozen run, seconds
const wasFlash = new Map(), wasDead = new Map();
let worstStreak = 0, longFrames = 0;
/* EFFECTIVENESS, so "it must not make broken troops better" is a number and
 * not an opinion: rising edges of the muzzle flash are shots fired, and
 * alive->dead transitions on each side are the exchange. All three are read off
 * the bodies rather than restated from any rule (HANDOFF §2.4). */
let shots = 0, foeKills = 0, allyLost = 0;

function classify(world) {
  let n = 0, moving = 0, firing = 0, idle = 0, blank = 0, foes = 0;
  for (const e of world.enemies) {
    const dead = !!e.dead;
    if (dead && !wasDead.get(e.id)) { if (e.trooper) allyLost++; else foeKills++; }
    wasDead.set(e.id, dead);
    if (dead) continue;
    if (!e.trooper) { foes++; continue; }
    const fl = (e.muzzleFlash || 0) > 0;
    if (fl && !wasFlash.get(e.id)) shots++;
    wasFlash.set(e.id, fl);
    n++;
    const v = Math.hypot(e.velocity?.x || 0, e.velocity?.z || 0);
    const mv = v >= 0.35;
    const fr = (e.burstLeft > 0) || (e.aimCharge > 0) || (e.muzzleFlash > 0);
    
    if (mv) moving++;
    if (fr) firing++;
    const frozen = !mv && !fr && (e.crouch || 0) < 0.5;
    if (!mv && !fr) idle++;
    if (frozen) blank++;
    const run = frozen ? (streak.get(e.id) || 0) + DT : 0;
    streak.set(e.id, run);
    if (run > worstStreak) worstStreak = run;
    if (run > 1.5) longFrames++;
  }
  return { n, moving, firing, idle, blank, foes };
}

async function condition(label, { formation = null, morale = null, seed = 20260820 } = {}) {
  const world = await seededWorld('geonosis', 'command', seed);
  const d = world.command;
  if (!d) { console.log(`${label}: NO COMMAND DIRECTOR`); return null; }
  const input = idleInput();
  d.start(1);
  // Let the army land and the first wave open.
  for (let i = 0; i < 12 * 30; i++) world.update(DT, input);
  if (formation) d.order(formation, d.commander);
  streak.clear(); wasFlash.clear(); wasDead.clear();
  worstStreak = 0; longFrames = 0; shots = 0; foeKills = 0; allyLost = 0;
  const tot = { n: 0, moving: 0, firing: 0, idle: 0, blank: 0, foes: 0, frames: 0 };
  for (let i = 0; i < SECS * 30; i++) {
    if (morale !== null) for (const t of d.roster.living) { t.morale = morale; t.broken = morale < 0.24; }
    world.update(DT, input);
    const c = classify(world);
    if (!c.n) continue;
    tot.n += c.n; tot.moving += c.moving; tot.firing += c.firing; tot.idle += c.idle;
    tot.blank += c.blank; tot.foes += c.foes; tot.frames++;
  }
  const pct = (x) => (100 * x / Math.max(1, tot.n)).toFixed(1).padStart(5) + '%';
  console.log(`${label.padEnd(20)} allies ${(tot.n / Math.max(1, tot.frames)).toFixed(1).padStart(4)}`
    + ` foes ${(tot.foes / Math.max(1, tot.frames)).toFixed(1).padStart(5)}`
    + `  moving ${pct(tot.moving)}  firing ${pct(tot.firing)}  stand ${pct(tot.idle)}`
    + `  FROZEN ${pct(tot.blank)}`
    + `  >1.5s ${pct(longFrames)}  worst ${worstStreak.toFixed(1)}s`
    + `   shots ${String(shots).padStart(4)} kills ${String(foeKills).padStart(3)} lost ${String(allyLost).padStart(3)}`);
  world.dispose?.();
  return tot.idle / Math.max(1, tot.n);
}

const { FORMATION_IDS } = await import('../src/game/Command.js');
console.log(`--- ${SECS}s per condition, geonosis, command ---`);
for (const f of FORMATION_IDS) await condition(`formation ${f}`, { formation: f });
console.log('--- morale forced ---');
await condition('broken (0.15)', { morale: 0.15 });
await condition('refusing (0.05)', { morale: 0.05 });
