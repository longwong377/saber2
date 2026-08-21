/**
 * THE BLAST RADIUS OF THE CHEST.
 *
 * `Enemy._shoot` led its aim on `target.chest ?? target.position`, and only
 * `Player` carries a `chest` — so every bolt fired at one of your own named
 * men, and every bolt your men fired back, was aimed at a pair of BOOTS.
 * Giving the shooter the one reader (`aimPoint`) roughly doubles the hit rate
 * on both sides at once, and every constant in the tree was tuned under the
 * old behaviour.
 *
 * This is the instrument that says by how much. It is `tools/_linehold.mjs`'s
 * engagement, phase-pinned identically and driven identically, with the damage
 * ledger of `tools/_linetoll.mjs` wrapped round it — so a before and an after
 * differ in the source change and in nothing else.
 *
 *   node --import ./tools/register.mjs tools/_lethality.mjs [mode] [seeds] [arms] [level] [engagement]
 *
 * FOUR QUANTITIES, all per GAME-second of the engagement so a run that lasts
 * longer does not read as a run that hurt more:
 *
 *   into the line   hp/s landing on party-team bodies that carry a roster
 *                   record. This is the horde's output onto your men.
 *   onto the horde  hp/s your LINE puts onto hostile bodies. Split from the
 *                   player's own, because in the arms where a Jedi is on the
 *                   field his blade would otherwise be read as the line's.
 *   the player      hp/s onto the player himself, and the second he falls.
 *                   Only meaningful in a MORTAL arm — see below.
 *   the clock       seconds per wave, from the director's own clear event.
 *
 * ARMS. `none`, `idle` and `blade` are `_linehold`'s and mean exactly what
 * they mean there — the player is held at full hp in the two that have one, so
 * the survival of the line is not confounded with the survival of the script.
 * `mortal` is this file's own: the `blade` script with the healing taken off,
 * which is the only arm in which the player-survival column means anything.
 *
 * EVERY RULE IN `_linehold`'s HEADER APPLIES HERE UNCHANGED — fresh processes
 * per arm, one invocation each, never compared across mode strings, and twenty
 * seeds for anything anybody intends to report. Five carry a standard error
 * near 1.3 men.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { Enemy, enemyRng } = await import('../src/game/Enemy.js');
const { Player } = await import('../src/game/Player.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');

const STEP = 1 / 30;
const CAP = 600;
const mode = process.argv[2] || 'theline';
const seeds = (process.argv[3] || '1,2,3,5,7').split(',').map(Number);
const arms = (process.argv[4] || 'none').split(',');
const level = process.argv[5] || 'geonosis';
const at = Math.max(1, Number(process.argv[6] || 1));

/* The live tally. One object per run; the wrappers below read this binding, so
 * nothing has to be threaded through `damage`'s own arguments. */
let T = null;

/**
 * Which side dealt it. `team` is the field every shooter in the game carries —
 * an Emplacement has one, a bolt's owner has one — and it is what
 * `World._boltHitTest` sorts on.
 *
 * THE PLAYER IS ON THE LINE'S TEAM and has to be split out by CLASS, which the
 * first cut of this got wrong: `Player.team` is 0, the same team the roster
 * stands on, so a Jedi's blade was being tallied as the line's rifles and one
 * arm read 7.17 hp/s onto the horde against the line's own 1.07. A trooper and
 * a B1 are both `Enemy`, so the class is the only thing that separates the
 * three parties.
 */
const sideOf = (s) => (s == null ? null : (s instanceof Player ? 'player' : (s.team ?? null)));

const realEnemyDamage = Enemy.prototype.damage;
Enemy.prototype.damage = function (amount, point, source, kind, ...rest) {
  const before = this.hp;
  const out = realEnemyDamage.call(this, amount, point, source, kind, ...rest);
  if (T) {
    const took = Math.max(0, before - this.hp);
    if (took > 0) {
      const side = sideOf(source);
      if (this.team === 0 && this.trooper) T.intoLine += took;
      else if (this.team !== 0) {
        if (side === 0) T.ontoHorde += took;
        else if (side === 'player') T.playerOut += took;
      }
    }
  }
  return out;
};

const realPlayerDamage = Player.prototype.damage;
Player.prototype.damage = function (amount, point, source, kind, ...rest) {
  const before = this.hp;
  const out = realPlayerDamage.call(this, amount, point, source, kind, ...rest);
  if (T) T.intoPlayer += Math.max(0, before - this.hp);
  return out;
};

/** Identical to `_linehold`'s. All THREE module-level streams; see its header
 * and HANDOFF §2.5b for what the missing third one cost. */
const phase = (seed) => {
  enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
  seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
  seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
};

let tNow = 0;

async function run(arm, seed) {
  phase(seed);
  const { world } = await H.bootWorld({
    level, spawn: arm !== 'none',
    settings: { mode, level, order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.onMuster = () => {};
  const waves = [];
  let lastClear = 0;
  const onClear = d.onWaveClear;
  d.onWaveClear = function (...a) {
    waves.push(+(tNow - lastClear).toFixed(1)); lastClear = tNow;
    return onClear?.apply(this, a);
  };
  let w0 = 1;
  if (at > 1) {
    d.areaIndex = Math.min(at - 1, d.stages.length - 1);
    for (let i = 0; i < d.areaIndex; i++) w0 += d.stages[i].waves;
  }
  d.start(w0);
  const n0 = d.roster.all.length;
  const input = (arm === 'blade' || arm === 'mortal') ? dutyInput(world) : H.idleInput();
  const immortal = arm !== 'mortal';
  T = { intoLine: 0, ontoHorde: 0, playerOut: 0, intoPlayer: 0 };
  let t = 0, ended = 'cap', fell = null;
  tNow = 0;
  for (let i = 0; i < CAP / STEP; i++) {
    if (world.player && immortal) world.player.hp = world.player.maxHp;
    input.tick?.(STEP);
    world.update(STEP, input); t += STEP; tNow = t;
    if (fell === null && world.player && world.player.hp <= 0) fell = t;
    if (d.mustering) { ended = 'cleared'; break; }
    if (world.over) { ended = 'over'; break; }
    if (d.roster.strength === 0) { ended = 'wiped'; break; }
  }
  const tal = T; T = null;
  world.unload();
  return { arm, seed, left: d.roster.strength, n0, t, wave: d.wave, ended, waves, fell, ...tal };
}

const rows = [];
for (const arm of arms) for (const seed of seeds) {
  const r = await run(arm, seed);
  rows.push(r);
  console.log(`  ${arm.padEnd(6)} seed ${String(r.seed).padStart(2)}  ${r.left}/${r.n0} left  `
    + `${r.t.toFixed(0)}s  wave ${r.wave}  ${r.ended.padEnd(7)}  `
    + `in ${(r.intoLine / r.t).toFixed(2)}  out ${(r.ontoHorde / r.t).toFixed(2)}  `
    + `player ${(r.intoPlayer / r.t).toFixed(2)}${r.fell === null ? '' : ` fell ${r.fell.toFixed(0)}s`}  `
    + `waves [${r.waves.join(' ')}]s`);
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

console.log(`\n${mode} · ${level} · engagement ${at} · n=${seeds.length} seeds`);
console.log('arm     survivors        into line   onto horde  player in   s/wave  cleared');
for (const arm of arms) {
  const a = rows.filter((r) => r.arm === arm);
  if (!a.length) continue;
  const left = a.map((r) => r.left);
  const w = a.flatMap((r) => r.waves);
  console.log(`${arm.padEnd(7)} `
    + `${mean(left).toFixed(2)} sd ${(sd(left) || 0).toFixed(2)}  `
    + `${mean(a.map((r) => r.intoLine / r.t)).toFixed(2)} hp/s   `
    + `${mean(a.map((r) => r.ontoHorde / r.t)).toFixed(2)} hp/s   `
    + `${mean(a.map((r) => r.intoPlayer / r.t)).toFixed(2)} hp/s   `
    + `${(w.length ? mean(w) : NaN).toFixed(0)}s    `
    + `${a.filter((r) => r.ended === 'cleared').length}/${a.length}`
    + `${a.some((r) => r.fell !== null) ? `   fell ${a.filter((r) => r.fell !== null).length}/${a.length}` : ''}`);
}
