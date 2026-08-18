/**
 * BATTLEFRONT BORZ — how much of the battlefield does the player actually HEAR?
 *
 *   node --import ./tools/register.mjs tools/_voiceprobe.mjs
 *   node --import ./tools/register.mjs tools/_voiceprobe.mjs --level colosseum --seconds 90
 *   node --import ./tools/register.mjs tools/_voiceprobe.mjs --range      (table 1 only)
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Player note #21 is "in general make the game more audible as far as voices —
 * I want to hear their screams and cheers". Everything built for it so far is
 * structurally correct and none of it was ever measured against the one number
 * that decides whether the note is answered: **how many voice lines reach the
 * player per minute of real fighting, and how many the rate limits threw away.**
 *
 * `tools/checks/voices.mjs` proves that every contour is distinct, that the
 * budgets exist and that each switch silences its own half. Not one of those
 * properties can tell you that four fifths of the room's lines are refused —
 * a budget doing its job and a budget strangling the feature look identical
 * from inside a unit check, because both of them look like "the budget was
 * honoured".
 *
 * ── WHAT IT DRIVES, AND WHAT IT REFUSES TO DRIVE ──────────────────────────
 *
 * A REAL World, a REAL director, the REAL Announcer, and — this is the part
 * that matters — the real `Enemy.cry` path, wired the way `src/main.js` wires
 * it. Nothing here re-implements a budget, a larynx map or a trigger; the only
 * thing this file decides is when to step the clock. Every number below is read
 * out of `Announcer.stats`, which the shipped code writes as it makes each
 * decision (HANDOFF §2.4 — an instrument that restates a rule manufactures
 * defects, and this project has four of those on the record).
 *
 * TWO HARNESS DECISIONS ARE DECLARED RATHER THAN HIDDEN:
 *
 *  1. THE PLAYER'S HEALTH IS PINNED. `tools/combat-trace.mjs` measures that a
 *     stationary player dies in about nine seconds from wave 2 on, so an
 *     un-pinned probe measures the first nine seconds of a wave and then
 *     silence. The room's line rate is what is being measured and it does not
 *     depend on the player's hit points except through deaths; pinning is what
 *     lets a full minute of a filled field be observed at all. It is stated in
 *     the output.
 *  2. THE BLADE SWINGS AND THE BODY DOES NOT MOVE. Same reason
 *     `combat-trace.mjs` gives: a wave that is never fought never fills, and a
 *     scripted kite is a measurement of the script.
 *
 * ── WHAT THE COLUMNS MEAN ─────────────────────────────────────────────────
 *
 *   spoke     lines that reached AudioEngine.speak and were not refused there
 *   /min      the same, per minute of game time — the number the note is about
 *   quip/effort/enemy/battle   refusals, by the BUDGET that refused them
 *   share     spoke ÷ (spoke + refusals) — how much of what the game tried to
 *             say the player was allowed to hear
 */

import './dom-shim.mjs';
import * as THREE from 'three';

if ((await import('three')) !== THREE) {
  console.error('\n  _voiceprobe.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/_voiceprobe.mjs\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const has = (n) => args.includes('--' + n);

const LEVEL = flag('level', 'colosseum');
const SECONDS = parseFloat(flag('seconds', '60'));
/** Which wave the director opens on — a wave-1 field is four bodies. */
const WAVE = parseInt(flag('wave', '1'), 10);
const SEED = parseInt(flag('seed', '4242'), 10);
/** Drive Command at its LAST area, which is the only place an officer fields. */
const LATE = has('late');
/* 1/30 and not 1/60, for `tools/checks/command.mjs`'s reason: these are
 * minute-long drives on a box that renders through swiftshader, and `main.js`
 * clamps dt at 0.1 s so 0.033 is well inside what the game is written for. */
const STEP = 1 / 30;

const { ENEMY_VOICES, ALL_VOICES, LINE_KINDS, ENEMY_LINES, utterance, peakGain } =
  await import('../src/engine/Voice.js');

/* ══════════════════════════════════════════════════════════════════════ */
/*  1. RANGE — what a line is worth at distance                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The panner law, read off the node the game builds rather than restated.
 *
 * `AudioEngine.speak` builds its output with `_panner(pos, 2.6, 120)` and every
 * other positional sound takes the defaults, so speech is the ONE sound in the
 * game on a different curve from the rest — which is exactly why the arithmetic
 * has to come from the same place twice rather than from a constant typed here.
 * `probePanner()` below builds a real panner through the shipped method and
 * reads its own fields back, so if the call site's numbers move, this table
 * moves with them.
 *
 * The formula is the WebAudio spec's `inverse` distance model, which is the one
 * `_panner` selects.
 */
function inverseLaw({ refDistance, maxDistance, rolloffFactor }) {
  return (d) => {
    const dd = Math.max(Math.min(d, maxDistance), refDistance);
    return refDistance / (refDistance + rolloffFactor * (dd - refDistance));
  };
}

/** Build one real panner through AudioEngine._panner and read its settings. */
function probePanner(AudioEngine, refDist, maxDist) {
  const made = [];
  const fake = {
    currentTime: 0,
    createPanner() {
      const p = { panningModel: '', distanceModel: '', refDistance: 0, maxDistance: 0,
        rolloffFactor: 0, positionX: null, setPosition() {} };
      made.push(p);
      return p;
    },
  };
  const eng = Object.create(AudioEngine.prototype);
  eng.ctx = fake;
  const call = refDist === undefined
    ? AudioEngine.prototype._panner.call(eng, { x: 0, y: 0, z: 0 })
    : AudioEngine.prototype._panner.call(eng, { x: 0, y: 0, z: 0 }, refDist, maxDist);
  return call;
}

async function rangeTable() {
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const world = probePanner(AudioEngine);                 // every one-shot
  const voice = probePanner(AudioEngine, 2.6, 120);       // AudioEngine.speak
  const lawW = inverseLaw(world), lawV = inverseLaw(voice);

  console.log('\n══ 1. RANGE — a positional voice against the room ═════════════════════\n');
  console.log(`  one-shot panner   ref ${world.refDistance}  max ${world.maxDistance}  rolloff ${world.rolloffFactor}`);
  console.log(`  speech panner     ref ${voice.refDistance}  max ${voice.maxDistance}  rolloff ${voice.rolloffFactor}`);

  const DIST = [2, 5, 10, 20, 40, 60, 80, 120, 190];
  const rows = [];
  for (const [kind, spec, gain, what] of [
    ['scream', ENEMY_VOICES.sith, 0.9, 'a man dying'],
    ['die', ENEMY_VOICES.droid, 0.9, 'a droid powering down'],
    ['flung', ENEMY_VOICES.trooper, 0.95, 'a body thrown'],
    ['cheer', ENEMY_VOICES.trooper, 0.95, 'your line cheering'],
    ['chatter', ENEMY_VOICES.droid, 0.9, 'idle droid banter'],
  ]) {
    const u = utterance(spec, kind, 0.5);
    const pk = peakGain(u) * gain;
    rows.push({ kind, what, dur: u.dur, peak: pk,
      at: DIST.map((d) => pk * lawV(d)) });
  }
  const w = DIST.map((d) => String(d).length + 5);
  console.log('\n  peak amplitude at the listener, at 0.9 on the Voices slider:\n');
  console.log('    line     dur   ' + DIST.map((d, i) => `${d}m`.padStart(w[i])).join(''));
  for (const r of rows) {
    console.log(`    ${r.kind.padEnd(8)} ${r.dur.toFixed(2)}  `
      + r.at.map((a, i) => (a * 0.9).toFixed(3).padStart(w[i])).join('')
      + `   ${r.what}`);
  }

  /**
   * THE BED IT HAS TO BE HEARD OVER. `HEARING_FLOOR`'s own note in Audio.js
   * measures a silent level's ambience at 0.013 RMS, and `SFX_DUCK` pulls the
   * whole effects bus to 0.62 of itself for as long as anyone is speaking — so
   * a voice is competing with about 0.008 and not with 0.013.
   */
  console.log('\n    the room it is heard over: 0.013 RMS of wind and drone, ducked to 0.008');
  console.log('    while any line is live (SFX_DUCK). A line is audible while it clears that.');

  /**
   * AND THE TWO CURVES AGREE WITH THE CULL, which is the thing that was wrong.
   *
   * `_reach` decides before any node exists whether a sound is worth a voice,
   * and it used to make that decision for SPEECH on the one-shot curve — 0.0411
   * predicted at 40 m against 0.0594 delivered, 45% under the truth, always in
   * the direction that throws a line away. Printed here as a comparison rather
   * than asserted, because a probe is not a check; `audio: a voice is judged on
   * the curve it is actually built on` is the one that fails the build.
   */
  const bad = lawW(40), good = lawV(40);
  console.log(`\n    at 40 m a voice arrives at ${good.toFixed(4)} of its own peak;`
    + ` the one-shot curve would have said ${bad.toFixed(4)}`
    + `\n    (${((good / bad - 1) * 100).toFixed(0)}% under, and _reach used to predict every scream that way).`);
  console.log(`    a blaster bolt is ${(0.32 * lawW(20)).toFixed(4)} at 20 m against a scream's `
    + `${(1.72 * 0.9 * lawV(20)).toFixed(4)} — voices are ${((1.72 * 0.9 * lawV(20)) / (0.32 * lawW(20))).toFixed(1)}x the fight.`);
  return { lawV, lawW };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2. A REAL WAVE                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The recording engine.
 *
 * It answers `speak` with the line's REAL duration — `utterance(...).dur`,
 * called and not restated — because every budget in the announcer is
 * `GAP + dur` and a stubbed constant would move all four of them.
 */
function recorder() {
  return {
    _listenerPos: new THREE.Vector3(),
    lines: [], levels: [],
    t: 0,
    /** Set by the drive loop. Who spoke is resolved on the FRAME it spoke:
     *  a body walks several metres while the line is still playing, so
     *  matching a position to a body afterwards matches the wrong body. */
    world: null,
    _who(pos) {
      if (!pos || !this.world) return null;
      let best = null, bd = 1e-3;
      for (const e of this.world.enemies) {
        if (!e?.position) continue;
        const d = e.position.distanceToSquared(pos);
        if (best === null || d < bd) { bd = d; best = e; }
      }
      return best;
    },
    speak(spec, kind, o = {}) {
      const dur = utterance(spec, kind, 0.5).dur;
      const who = o.self ? null : this._who(o.pos);
      this.lines.push({ id: spec.id, kind, self: !!o.self, gain: o.gain, t: this.t, dur,
        team: who ? who.team : null, type: who ? who.type : null,
        pos: o.pos ? { x: o.pos.x, y: o.pos.y, z: o.pos.z } : null });
      return dur;
    },
    setVoiceLevel(v) { this.levels.push(v); },
    /* Everything else a body's own presence plays. The announcer never calls
     * these; the World does, through Presence, and a missing method throws. */
    footfall() {}, step() {}, servo() {}, breath() {}, bodyThump() {},
  };
}

const hudStub = () => ({ pops: [], popup(t, s, k) { this.pops.push({ t, s, k }); } });

/**
 * A BLADE BEING SWEPT, and nothing else — `tools/combat-trace.mjs`'s driver.
 *
 * Read its note before changing this: THERE IS NO ATTACK BUTTON IN THIS GAME.
 * `SaberController.applyInput` drives the blade off the MOUSE DELTA and
 * `mouse.left` is read by nothing anywhere in src/, so an input that holds the
 * left button reports a wave of zero kills as though a blade had been swinging
 * through it. Two frequencies rather than one so the tip covers an arc instead
 * of retracing a line. No power is ever pressed.
 */
const swinging = () => ({
  frame: 0,
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
  step() {
    this.frame++;
    this.mouse.dx = 62 * Math.sin(this.frame * 0.41);
    this.mouse.dy = 38 * Math.cos(this.frame * 0.29);
  },
  end() { this.mouse.dx = 0; this.mouse.dy = 0; },
});

async function drive({ level, seconds, mode, order, wave = 1 }) {
  const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
  const { Announcer } = await import('../src/ui/Announcer.js');
  /**
   * SEEDED, BECAUSE THIS IS A MEASUREMENT AND NOT AN ANECDOTE.
   *
   * Un-seeded, the same command produced 2 bodies alive on one run and 14 on
   * the next — three module-scope streams (`rng` in Waves, `enemyRng`,
   * `duelRng`) carry over from whatever ran before, exactly as
   * `tools/checks/_shared.mjs` documents. Every stream the fight draws on is
   * put back to a named number here, so two runs of this file are comparable
   * and an A/B against a change in Announcer.js measures the change.
   */
  const { seedWaves } = await import('../src/game/Waves.js');
  const { enemyRng } = await import('../src/game/Enemy.js');
  const { duelRng } = await import('../src/game/Duel.js');
  seedWaves(SEED);
  enemyRng.seed(4711);
  duelRng.seed(8123);
  const settings = mode === 'command'
    ? { mode: 'command', level, order: order || 'jedi' }
    : { mode: 'waves', level };
  const { world } = await bootWorld({ level, settings: { ...settings, quality: 'low', seed: SEED } });
  world.runSeed = SEED;
  const rec = recorder();
  rec.world = world;
  const an = new Announcer(rec);
  const hud = hudStub();
  /**
   * THE ONE WIRE, AND IT IS THE GAME'S OWN.
   *
   * `src/main.js` sets `world.onEnemyVoice` to hand the event to the announcer,
   * and every `Enemy.cry` in the game — the hurt cry, the scream on a hard
   * knockback, the witness's panic — arrives through it. A probe that skipped
   * it would measure a game with half its voice missing and report the half as
   * the whole.
   */
  world.onEnemyVoice = (e, kind) => an.enemyLine(e, kind, world.settings.enemyVoices !== false);

  /* The director is started the way `tools/checks/command.mjs` starts one, in
   * both modes — Command's own deploy hangs off it, and a probe that skipped it
   * measured an empty field and reported it as an army that never speaks. */
  if (mode === 'command' && world.command && LATE) {
    /* THE LAST AREA. Both bodies that carry `commandAura` — the Clone Commander
     * and the MagnaGuard — are `unlockAt: 9` and priced at the top of their
     * army's ladder, so an early field has no officer in it at all and the
     * rally shout has nothing to come out of. Same two lines `command.mjs` uses
     * to reach the end of a campaign. */
    world.command.areaIndex = world.command.constructor ? world.command.areaIndex : 0;
    const Cmd = await import('../src/game/Command.js');
    world.command.areaIndex = Cmd.AREAS.length - 1;
    world.command.roster.points += 60;
  }
  if (world.director?.start) world.director.start(wave);
  const p = world.player;
  const input = swinging();
  void idleInput;

  const n = Math.round(seconds / STEP);
  let peakAlive = 0, aliveSum = 0;
  /* Bodies observed to CROSS into death while the announcer was watching. It is
   * the denominator for "how many of the deaths did the player hear", and it
   * has to be counted here because a corpse is spliced out of `world.enemies`
   * a few seconds later and nothing afterwards can count it. */
  const died = new Set();
  for (let i = 0; i < n; i++) {
    rec.t = i * STEP;
    input.step();
    world.update(STEP, input);
    input.end();
    // Declared in the header: the room's line rate is the subject, and a player
    // who dies at nine seconds measures nine seconds of it.
    if (p) { p.hp = p.maxHp; p.alive = true; }
    rec._listenerPos.copy(p?.chest || p?.position || rec._listenerPos);
    an.update(STEP, world, p, hud);
    for (const e of world.enemies) if (e.dead) died.add(e);
    const alive = world.enemies.filter((e) => !e.dead).length;
    if (alive > peakAlive) peakAlive = alive;
    aliveSum += alive;
  }
  const { AudioEngine } = await import('../src/engine/Audio.js');
  const maxSpeech = Object.create(AudioEngine.prototype) && new AudioEngine().maxSpeech;
  return { world, an, rec, hud, peakAlive, meanAlive: aliveSum / n, seconds, maxSpeech,
    died: died.size, kills: p?.kills ?? 0 };
}

function report(title, r) {
  const { an, rec, seconds } = r;
  const s = an.stats;
  const ref = s.refused;
  const budget = ref.quip + ref.effort + ref.enemy + ref.battle;
  const spoke = rec.lines.length;
  const tried = spoke + budget + ref.off + ref.engine;
  console.log(`\n══ ${title} ═════════════════════════════════════════\n`);
  console.log(`  ${seconds.toFixed(0)} s of game time · peak ${r.peakAlive} bodies alive, mean ${r.meanAlive.toFixed(1)}`
    + ` · ${r.died} bodies fell (${r.kills} to the player)`);
  console.log(`  spoke ${spoke}  →  ${(spoke * 60 / seconds).toFixed(1)} lines/min`);
  console.log(`  gate refusals: quip ${ref.quip}  effort ${ref.effort}  shared ${ref.enemy}  `
    + `per-event ${ref.battle}  expired ${ref.stale}   (${s.held} lines were held and re-offered)`);
  const lostN = Object.values(s.lost).reduce((a, b) => a + b, 0);
  console.log(`  raised ${spoke + lostN}, HEARD ${spoke}, lost ${lostN}`
    + ` — ${(100 * spoke / Math.max(1, spoke + lostN)).toFixed(0)}% of what the game tried to say`);
  void tried;
  const byKind = {};
  for (const l of rec.lines) byKind[l.kind] = (byKind[l.kind] || 0) + 1;
  const order = LINE_KINDS.filter((k) => byKind[k]);
  console.log('  heard: ' + (order.length
    ? order.map((k) => `${k} ${byKind[k]}`).join('  ')
    : '— nothing at all —'));
  const lost = LINE_KINDS.filter((k) => s.lost[k]);
  if (lost.length) console.log('  never heard at all: ' + lost.map((k) => `${k} ${s.lost[k]}`).join('  '));
  const silent = LINE_KINDS.filter((k) => !byKind[k]);
  if (silent.length) console.log('  never heard: ' + silent.join(' '));

  /**
   * IS THE ENGINE'S OWN CAP THE BINDING ONE, or the announcer's budgets?
   *
   * `AudioEngine.speak` refuses a fourth simultaneous utterance whatever the
   * announcer decided, so loosening a budget past that ceiling buys nothing.
   * The cap is read off a real engine object rather than typed here, and the
   * concurrency is reconstructed from the durations the recorder was handed —
   * which are `utterance().dur`, the same number the engine schedules against.
   */
  let live = [], worst = 0, overCap = 0, voiced = 0, openTill = -1;
  for (const l of rec.lines) {
    live = live.filter((e) => e > l.t);
    if (live.length >= r.maxSpeech) overCap++;
    live.push(l.t + l.dur);
    if (live.length > worst) worst = live.length;
    // how much of the minute has ANY voice in it — the wall-of-sound reading
    const from = Math.max(l.t, openTill);
    if (l.t + l.dur > from) voiced += l.t + l.dur - from;
    openTill = Math.max(openTill, l.t + l.dur);
  }
  console.log(`  most lines alive at once: ${worst} (the engine refuses a ${r.maxSpeech + 1}th`
    + `, which would have cost ${overCap} of these)`);
  console.log(`  ${(100 * voiced / seconds).toFixed(0)}% of the minute has a voice in it`);
  return { spoke, byKind, ref };
}

/** Who spoke — the player, the horde, or your own line. */
/** What the field CONTAINED — the denominator for anything it never said. */
function census(r) {
  const seen = new Map();
  for (const e of r.world.enemies) if (e?.A) seen.set(e.A.label || e.type, (seen.get(e.A.label || e.type) || 0) + 1);
  const aura = r.world.enemies.filter((e) => e?.A?.commandAura).length;
  return { types: [...seen.entries()].map(([k, n]) => `${k}\u00d7${n}`).join(' '), aura };
}

function bySide(r) {
  const tally = { self: 0, yours: 0, theirs: 0, unplaced: 0 };
  const mine = r.world.player?.team ?? 0;
  for (const l of r.rec.lines) {
    if (l.self) tally.self++;
    else if (l.team === null || l.team === undefined) tally.unplaced++;
    else if (l.team === mine) tally.yours++;
    else tally.theirs++;
  }
  return tally;
}

/* ══════════════════════════════════════════════════════════════════════ */

await rangeTable();
if (has('range')) process.exit(0);

const wave = await drive({ level: LEVEL, seconds: SECONDS, mode: 'waves', wave: WAVE });
report(`2. A REAL WAVE — ${LEVEL} wave ${WAVE}, swing-only, health pinned`, wave);
{ const c = census(wave); console.log(`  the field: ${c.types}\n  ${c.aura} bodies carry a rally aura`); }
wave.world.unload();

const cmd = await drive({ level: 'geonosis', seconds: SECONDS, mode: 'command', wave: WAVE });
const cr = report('3. COMMAND — geonosis, an army of your own', cmd);
{ const c = census(cmd); console.log(`  the field: ${c.types}\n  ${c.aura} bodies carry a rally aura`); }
const side = bySide(cmd);
const allies = cmd.world.enemies.filter((e) => !e.dead && e.team === (cmd.world.player?.team ?? 0)).length;
console.log(`  ${allies} of your own troops standing at the end`);
console.log(`  who spoke: you ${side.self}  your line ${side.yours}  the horde ${side.theirs}`
  + (side.unplaced ? `  (${side.unplaced} could not be placed)` : ''));
void cr;
cmd.world.unload();

console.log('');
process.exit(0);
