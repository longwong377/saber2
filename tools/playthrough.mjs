/**
 * BATTLEFRONT BORZ — WHAT A RUN IS LIKE TO PLAY, AT THE LENGTH IT IS PLAYED.
 *
 *   node --import ./tools/register.mjs tools/playthrough.mjs
 *   node --import ./tools/register.mjs tools/playthrough.mjs --mode theline --minutes 20
 *   node --import ./tools/register.mjs tools/playthrough.mjs --json > run.json
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS AND WHAT IT IS NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * There are three instruments in this repository and none of them plays.
 *
 *   `verify.mjs`   1140 checks, and every one of them is a PROPERTY. A check
 *                  drives twenty seconds because that is what a property needs
 *                  and because 146 suites of five minutes is a gate nobody can
 *                  afford to run. Nothing about a check is wrong; it is simply
 *                  not a thing that can tell you a run gets boring at minute
 *                  fourteen.
 *   `trace.mjs`    reads the shipped tables and the shipped composer and says
 *                  what a run CONTAINS. It never presses a button, which its
 *                  own note is explicit about.
 *   `balance.mjs`  models an abstract player who also never presses a button.
 *
 * So the whole tree is measured in twenty-second slices and read off tables,
 * and the one question nobody can ask is: what HAPPENS, in order, over the
 * thirty to forty-five minutes a plan is written for? A curve that only bends
 * after minute ten is invisible to every instrument above, and every finding
 * about pacing this project has had came from a human playing.
 *
 * ── THE DISCIPLINE, BORROWED WHOLE FROM trace.mjs ─────────────────────────
 *
 * NOTHING IN THIS FILE HAS AN OPINION. No bars, no assertions, no "too few" and
 * no "should be". The moment it scores, it is a check with a hand-written bar,
 * and this project has spent whole sessions removing exactly that shape. It
 * reports a timeline and the judging is somebody else's.
 *
 * It also does not model a player: it DRIVES one. `dutyInput` from
 * `_flagship.mjs` is the repository's one scripted Jedi — it holds station on
 * its own line, meets what comes, and keeps itself on its feet — and this file
 * imports it rather than writing a second, for the reason that file's own note
 * gives. What that Jedi does is a Vanguard's twenty minutes and not a survey of
 * playstyles, and the report says so on every line.
 *
 * ── AND IT COUNTS CPU TIME, NOT WALL CLOCK ────────────────────────────────
 *
 * HANDOFF §2.6b: a millisecond without a load average beside it is a number
 * about the machine. Every timing below is `process.cpuUsage()` and the load
 * average is printed with them.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { loadavg } from 'node:os';

if ((await import('three')) !== THREE) {
  console.error('\n  playthrough.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/playthrough.mjs\n');
  process.exit(2);
}

const arg = (name, def = null) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : (i >= 0 ? true : def);
};
const JSON_OUT = process.argv.includes('--json');

const MODE = String(arg('mode', 'command'));
const LEVEL = arg('level', null);
const MINUTES = Number(arg('minutes', 20));
const SEED = Number(arg('seed', 7));
const ORDER = String(arg('order', 'jedi'));
const DIFFICULTY = String(arg('difficulty', 'knight'));
/** How often the timeline takes a reading, in game seconds. */
const SAMPLE = Number(arg('sample', 30));
/** The step. 1/30 rather than 1/60: this is forty thousand frames and the
 *  quantities below are all second-scale. `_flagship.mjs` drives at the same. */
const STEP = 1 / 30;

/* ══════════════════════════════════════════════════════════════════════ */

const { bootWorld } = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { MODES } = await import('../src/game/Waves.js');
const { theatreFor, LEVELS } = await import('../src/game/Levels.js');

const level = LEVEL || theatreFor(MODE, null, SEED);
const settings = {
  mode: MODE, level, order: ORDER, seed: SEED, difficulty: DIFFICULTY,
  /* THE FLIGHT IS SKIPPED, and it is the one thing this instrument declines to
   * play. `Extraction.beginInsertion` is thirty game-seconds of a transport
   * coming down with nothing on the field — `frontdoor.mjs` and
   * `extraction.mjs` already measure it end to end, and thirty seconds of an
   * empty sky at the top of every run would be a twentieth of the horizon
   * spent on a cutscene two suites already own. */
  instantSpawn: true,
  quality: 'low',
};

const { world } = await bootWorld({ level, settings });

/* THE MODE'S OWN OPENING, through the same branch main.js takes. A meeting
 * hands out sides and starts itself; a campaign begins a campaign; everything
 * else starts a wave. Copied in shape, not in words — see main.js's `deploy`. */
if (world.command?.versus) world.beginVersus();
else if (MODES[MODE]?.picksCampaign) world.beginCampaign();
else world.director.start(1);

const input = dutyInput(world);

/* ── what a reading is ─────────────────────────────────────────────────── */

const roster = () => world.command?.roster ?? null;
const p = () => world.player;

/**
 * ONE ROW OF THE TIMELINE.
 *
 * Everything is read off the world; nothing is derived twice and nothing is
 * modelled. A field that the mode does not have reads null rather than 0 —
 * `Waves` has no roster and a duel has no areas, and a zero there would be a
 * statement about the mode that is not true.
 */
const reading = (t) => {
  const r = roster();
  const pl = p();
  const alive = world.enemies.filter((e) => !e.dead);
  return {
    t: +t.toFixed(1),
    wave: world.director?.wave ?? null,
    /* WHAT IS ON THE FIELD, split the way the fight splits: yours and theirs.
     * `enlistBody` puts your named troopers in `world.enemies` on the party's
     * team, so a bare count of `enemies` is the sum of two armies. */
    hostile: alive.filter((e) => e.team !== world.partyTeam).length,
    friendly: alive.filter((e) => e.team === world.partyTeam).length,
    /* THE PLAYER, as the four bars a player watches. */
    hp: pl ? +(pl.hp ?? 0).toFixed(1) : null,
    force: pl ? +(pl.force ?? 0).toFixed(1) : null,
    stamina: pl ? +(pl.stamina ?? 0).toFixed(1) : null,
    alive: pl ? pl.alive !== false : null,
    kills: world.players.reduce((a, q) => a + (q.kills || 0), 0),
    score: world.score | 0,
    /* THE ROSTER, which is the mode's one-way variable: it only ever shrinks
     * within a run, so a timeline of it IS the story of the run. */
    living: r ? r.living.length : null,
    fallen: r ? r.fallen.length : null,
    /* …AND HOW STEADY THEY ARE. The mean of the record's own morale, and how
     * many are past MORALE.BREAK. A line that is holding and a line that is
     * about to run look identical in a body count. */
    morale: r && r.living.length
      ? +(r.living.reduce((a, x) => a + (x.morale ?? 0), 0) / r.living.length).toFixed(3) : null,
    broken: r ? r.living.filter((x) => x.broken).length : null,
    /**
     * THE DIRECTOR'S OWN COUNTERS, and the first run without them cost an
     * afternoon.
     *
     * The timeline showed six minutes of "one hostile, no roster, no
     * announcements, nothing happening" and there is no way to read that. A
     * wave holding open on one body the player cannot reach, a delivery that
     * never finished, and a run quietly over all look identical in a body
     * count. These three say which:
     *
     *   `remaining`  what the wave still owes. Frozen beside a frozen
     *                `hostile` is a wave holding open.
     *   `delivered`  whether every body of the wave has arrived. FALSE here
     *                disables the stall watchdog entirely (`Waves.js`'s
     *                `blocking`), so a stuck delivery is a stuck RUN and this
     *                is the one field that says so.
     *   `rescues`    how many bodies the watchdog has had to relocate. It is
     *                cumulative, so the SLOPE is the reading: 61 over fifteen
     *                minutes is bodies routinely failing to reach the fight.
     */
    remaining: world.director?.remaining ?? null,
    delivered: world.director?.delivered ?? null,
    rescues: (world.director?.rescues || []).length,
    /* THE GROUND. `areasTaken` for a campaign, `front` for a meeting. */
    areas: world.command?.areasTaken ?? null,
    front: world.command?.front != null ? +world.command.front.toFixed(3) : null,
    /* AND WHAT THE FRAME IS COSTING. `renderer.info` is a stub headless, so
     * these are the counts the world itself keeps. */
    bodies: world.physics?.stats?.bodies ?? null,
    props: world.props?.length ?? null,
  };
};

/* ── the events ────────────────────────────────────────────────────────── */

/**
 * EVERYTHING THE GAME SAID, WITH THE CLOCK ON IT.
 *
 * `World.notify` is the one door every announcement in the game goes through —
 * a wave, a casualty, a promotion, a stratagem released, the ship called — so
 * hooking it is hooking the whole of what a player is told. It is also the one
 * place this file could accidentally change the run, so the original is called
 * and its return handed straight back.
 */
const events = [];
const rawNotify = world.notify.bind(world);
world.notify = (title, sub, kind) => {
  events.push({ t: +world.time.toFixed(1), title: String(title ?? ''), sub: String(sub ?? ''), kind: kind ?? 'flavour' });
  return rawNotify(title, sub, kind);
};

/** …and the ending, whichever door it comes through. */
let ended = null;
world.onGameOver = (stats) => { if (!ended) ended = { t: +world.time.toFixed(1), ...stats }; };

/* ── the drive ─────────────────────────────────────────────────────────── */

const rows = [];
const frames = Math.round(MINUTES * 60 / STEP);
const t0 = process.cpuUsage();
let stepped = 0, next = 0;
/** The worst single frame, in CPU microseconds, and when it happened. */
let worstFrame = { us: 0, t: 0 };

for (let i = 0; i < frames; i++) {
  const f0 = process.cpuUsage();
  input.tick?.(STEP);
  world.update(STEP, input);
  const f = process.cpuUsage(f0);
  const us = f.user + f.system;
  /* NOT THE FIRST SECOND. Measured at 225 ms against a 24 ms median: the
   * opening frames pay for every lazily built thing the world puts off until
   * something asks — the first rig, the first pool, the first shader compile —
   * and a "worst frame" that is always frame 1 is a number about module
   * initialisation rather than about play. `scale.mjs` settles its ground for
   * the same reason and its note carries the measurement. */
  if (world.time > 1 && us > worstFrame.us) worstFrame = { us, t: +world.time.toFixed(1) };
  stepped++;
  if (world.time >= next) { rows.push(reading(world.time)); next += SAMPLE; }
  /* THE RUN ENDING IS THE END OF THE RUN. Driving past `over` is driving a
   * corpse — every director returns early on it — and the frames would be
   * counted into the cost as though they were play. */
  if (ended || world.over) break;
}
const cpu = process.cpuUsage(t0);
rows.push(reading(world.time));

/* ── the report ────────────────────────────────────────────────────────── */

const r = roster();
const played = world.time;
const report = {
  mode: MODE, level, levelName: LEVELS[level]?.name ?? level,
  seed: SEED, order: ORDER, difficulty: DIFFICULTY,
  askedMinutes: MINUTES,
  playedSeconds: +played.toFixed(1),
  playedMinutes: +(played / 60).toFixed(2),
  frames: stepped,
  /* How much of the drive the world did not advance for — the hitstop, as a
   * percentage. One statement of "the run was in slow motion for this long". */
  dilated: +(100 * Math.max(0, 1 - played / (stepped * STEP))).toFixed(1),
  /* THE COST OF PLAYING IT, in the units HANDOFF §2.6b asks for. */
  cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(0),
  msPerFrame: +((cpu.user + cpu.system) / 1000 / Math.max(1, stepped)).toFixed(3),
  worstFrameMs: +(worstFrame.us / 1000).toFixed(2),
  worstFrameAt: worstFrame.t,
  load1: +loadavg()[0].toFixed(2),
  ended: ended ? { at: ended.t, why: ended.ended ?? (ended.won === true ? 'won' : ended.won === false ? 'lost' : 'unknown'),
    won: ended.won ?? null, wave: ended.wave ?? null, kills: ended.kills ?? null } : null,
  finalWave: world.director?.wave ?? null,
  kills: world.players.reduce((a, q) => a + (q.kills || 0), 0),
  roster: r ? {
    enlisted: r.all.length, living: r.living.length, fallen: r.fallen.length,
    /* THE NAMES, because §13 makes the name list the mode's fallback spine and
     * a count of the dead is not the same object as a list of who they were. */
    dead: r.fallen.map((x) => ({ name: x.name, type: x.type, kills: x.kills | 0, areas: x.areas | 0 })),
  } : null,
  /* THE SCRIPT'S OWN TALLY, so a reader can tell a quiet run from a run the
   * script never fought. `dutyInput` counts its swings, its pushes and the
   * times it put the Jedi back on its feet. */
  script: input.tally ? { ...input.tally, t: +(input.tally.t ?? 0).toFixed(1) } : null,
  timeline: rows,
  events,
};

if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

/* ── printed ───────────────────────────────────────────────────────────── */

const pad = (s, n) => String(s ?? '·').padStart(n);
console.log(`\n  ${report.levelName} · ${MODES[MODE]?.name ?? MODE} · seed ${SEED} · ${ORDER} · ${DIFFICULTY}`);
/* GAME SECONDS AND FRAMES ARE DIFFERENT QUANTITIES AND BOTH ARE PRINTED. The
 * drive steps a fixed 1/30 and the WORLD advances by less than that whenever a
 * hitstop is banked, so a run driven for two real minutes reports 1.73 played.
 * That gap is a fact about how much of the run was in slow motion, which is
 * worth reading; collapsing them would hide it. */
console.log(`  ${report.playedMinutes} min of game time over ${report.frames} frames `
  + `(${(MINUTES * 60 / STEP) | 0} asked, ${report.dilated}% of the drive spent dilated) · `
  + `${report.cpuMs} ms CPU (${report.msPerFrame} ms/frame, worst ${report.worstFrameMs} at ${report.worstFrameAt}s, `
  + `load ${report.load1})`);
if (report.ended) {
  console.log(`  ENDED at ${report.ended.at}s — ${report.ended.why}`
    + (report.ended.won === null ? '' : report.ended.won ? ' (won)' : ' (lost)'));
} else {
  console.log(`  still running at ${report.playedSeconds}s — the horizon ran out before the run did`);
}

console.log('\n   t(s)  wave  left  dlv  resc  them   you   hp  force  stam  living fallen morale brk  areas  front  kills');
for (const x of rows) {
  console.log(`  ${pad(x.t, 5)} ${pad(x.wave, 5)} ${pad(x.remaining, 5)} `
    + `${pad(x.delivered === null ? '·' : (x.delivered ? 'y' : 'n'), 4)} ${pad(x.rescues, 5)} `
    + `${pad(x.hostile, 5)} ${pad(x.friendly, 5)} `
    + `${pad(x.hp, 4)} ${pad(x.force, 6)} ${pad(x.stamina, 5)} ${pad(x.living, 6)} ${pad(x.fallen, 6)} `
    + `${pad(x.morale, 6)} ${pad(x.broken, 3)} ${pad(x.areas, 6)} ${pad(x.front, 6)} ${pad(x.kills, 6)}`);
}

if (report.roster) {
  console.log(`\n  roster: ${report.roster.enlisted} enlisted, ${report.roster.living} standing, `
    + `${report.roster.fallen} fallen`);
  for (const d of report.roster.dead) {
    console.log(`    ✝ ${d.name} — ${d.type}, ${d.kills} down, ${d.areas} grounds`);
  }
}
if (report.script) {
  console.log(`\n  the script: ${report.script.swings} swings, ${report.script.pushes} pushes, `
    + `${report.script.heals} times put back on its feet`
    + (report.script.downAt != null ? `, first down at ${report.script.downAt}s` : ''));
}

/**
 * THE EVENTS, DEDUPLICATED BY TITLE.
 *
 * A twenty-minute run raises several hundred notifications and most of them are
 * the same six titles. Printing all of them buries the one that happened once,
 * which is the one worth reading — so each title prints its FIRST occurrence
 * with a count beside it, and a title that only ever happened once prints as
 * itself. The full list is in `--json`.
 */
console.log(`\n  ${events.length} announcements, ${new Set(events.map((e) => e.title)).size} distinct:`);
const seen = new Map();
for (const e of events) {
  if (!seen.has(e.title)) seen.set(e.title, { first: e, n: 0 });
  seen.get(e.title).n++;
}
for (const [title, v] of [...seen.entries()].sort((a, b) => a[1].first.t - b[1].first.t)) {
  console.log(`    ${pad(v.first.t, 6)}s  ${title}${v.n > 1 ? ` ×${v.n}` : ''}`
    + (v.first.sub ? ` — ${v.first.sub}` : ''));
}
console.log('');
