/**
 * BATTLEFIELD BORZ — THE LINE, the flagship mode.
 *
 * `FLAGSHIP.md` §2 is one sentence long and everything else in that document
 * is an argument for it: **you are not the protagonist, the squad is.** §1
 * states the consequence as a rule — "a run that kills three hundred droids
 * and loses the squad is a loss" — and for the whole life of Command that
 * sentence was a slogan. `_endCampaign` wrote `won: true` off having reached
 * the last area and never looked at the roster, and there was no path in the
 * tree by which an emptied roster ended anything at all: the run ends on
 * `World._checkWipe`, which counts PLAYERS. A Jedi standing over ten graves
 * kept fighting and took the ridge and got the victory card.
 *
 * ── WHAT THIS SUITE IS FOR ──────────────────────────────────────────────
 *
 * The mode shares a director with Command on purpose — §14 prices it at
 * "~1,100 lines of spine against ~12,000 lines of existing machinery" — so
 * almost everything true of it is already held by `command.mjs`, `muster.mjs`,
 * `session.mjs` and `campaigns.mjs`, and restating any of that here would be
 * the twin this repository keeps deleting. What is HERE is the difference
 * between the two modes, which is exactly one rule, plus the wiring that rule
 * needs to be reachable at all: the mode has to build the right director on
 * the right ground, and its verdict has to be computed rather than declared.
 *
 * Nothing below reads Waves.js as text for the rule itself. Every verdict
 * check drives a real World to a real ending and reads the summary that
 * `onGameOver` actually delivered — the object `Progress.recordRun` will store
 * and the card will print.
 */

import * as Cmd from '../../src/game/Command.js';
import * as Waves from '../../src/game/Waves.js';
import { LEVELS } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

/** 1/30 for the reason `command.mjs` gives: these drives are game-minutes long
 *  and this box renders through swiftshader. HANDOFF §2.6. */
const STEP = 1 / 30;

async function lineWorld(opts = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: opts.mode || 'theline', level: 'geonosis', order: opts.order || 'jedi' },
    /* `runSeed` and not `settings.seed`: the run's number is a property of the
     * SITTING and main.js writes it onto the world before the level loads,
     * which is the door the director reads it through. See `bootWorld`. */
    runSeed: opts.seed ?? null,
  });
  const d = world.command;
  if (d && opts.start !== false) {
    d.start(1);
    if (opts.trim !== undefined) d.spawnQueue.length = Math.min(d.spawnQueue.length, opts.trim);
  }
  return { world, d, input: idleInput() };
}

function drive(world, seconds, input, until = null, keepAlive = false) {
  const n = Math.round(seconds / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    /* KEEPING THE JEDI ON THEIR FEET IS NOT CHEATING HERE, it is what makes
     * the arm mean anything. An arm that empties the roster and then drives a
     * lone Jedi through a composed wave measures whether that Jedi survives,
     * and when they do not the run ends through `World._checkWipe` with
     * `won: false` — which reads exactly like the verdict under test and is a
     * different fact entirely. Measured: the Command arm ended on wave 1 with
     * the campaign untouched and `director.done` still false. */
    if (keepAlive && world.player) world.player.hp = world.player.maxHp;
    world.update(STEP, input); t += STEP; if (until && until(t)) break;
  }
  return t;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The mode is reachable, and it is a crossing                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('theline.1 the mode exists, owns its ground, and builds an army', async () => {
    /**
     * THE WIRING, AND THE PART OF IT THAT SILENTLY DOES NOTHING.
     *
     * `World.loadLevel` decided which director to build with
     * `mode === 'command' || battles`, a mode-name literal, so a new mode that
     * is a crossing would have been handed `campaign: false` and quietly got a
     * plain `WaveDirector`: no roster, no names, no muster, no ending — the
     * mode's entire subject absent, with every menu card still lit. That is
     * why this asks the WORLD what it built rather than asking Waves.js what
     * it declared.
     */
    const M = Waves.MODES.theline;
    assert(M, 'there is no `theline` mode');
    assert(typeof M.name === 'string' && M.name.length, 'the mode has no name');
    assert(typeof M.blurb === 'string' && M.blurb.length > 40, 'the mode has no blurb to put on its card');
    assert(M.fixedTheatre, 'the mode does not tell the menu it owns its ground');
    assert(M.level && LEVELS[M.level], `the mode declares no real ground (level=${M.level})`);

    const { world, d } = await lineWorld({ start: false });
    assert(d, 'the mode built no army — `World.loadLevel` did not give it a CommandDirector');
    assert(d instanceof Cmd.CommandDirector, 'the mode leads an army that is not a CommandDirector');
    assert(d.campaign, 'the mode leads an army with no campaign — it is not a crossing');
    assert(d.crossing, 'the mode is not a crossing, so it gets no seeded length and no stages');
    assert(d.roster.all.length > 0, 'the mode deployed with nobody on the roll');
    assert(d.roster.all.every((t) => t.name), 'a body on the roll has no name');
    const n = d.roster.all.length;
    world.unload();
    return `${d.stages.length} stages, ${n} names, plan "${d.plan.id}"`;
  });

  check('theline.2 it reads the win rule off the mode, and Command does not', async () => {
    /* The rule is a FIELD, so a second mode that wants it takes the field
     * rather than adding its name to a branch. Both directors are built
     * through the real load path — the whole failure mode being guarded
     * against is a flag that is declared and never read. */
    const a = await lineWorld({ start: false });
    const b = await lineWorld({ start: false, mode: 'command' });
    assert(a.d.holdTheLine, 'The Line does not hold the line — the win rule is off');
    assert(!b.d.holdTheLine, 'Command took The Line\'s win rule, which changes a shipped mode');
    a.world.unload(); b.world.unload();
    return 'the inversion is on in one mode and off in the other';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The rule itself                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('theline.3 a crossing finished with nobody left is a LOSS', async () => {
    /**
     * THE MODE, IN ONE CHECK. Drive a real run to the real ending — the
     * shipped path, `payWave` → `_areaClear` → `lastArea` → `_endCampaign` —
     * with the roster killed off first, and read the summary `onGameOver`
     * delivered. In Command that object says `won: true`. Here it must not.
     *
     * The roster is emptied by killing the RECORDS rather than by staging a
     * battle that kills them, and that is deliberate: what is under test is
     * the verdict, and a fight long enough to lose ten men honestly would make
     * this check a measurement of the difficulty curve instead.
     */
    const { world, d, input } = await lineWorld({ trim: 2 });
    d.areaIndex = d.stages.length - 1;
    d.areaWaves = d.area.waves - 1;
    assert(d.lastArea, 'the fixture did not reach the last area');
    /* Landed once, then gone: `_checkLine`'s own gate. Without the first half
     * this would be indistinguishable from a run that has not deployed. */
    assert(d._landed, 'the fixture never put an army on the ground');
    for (const t of d.roster.all) { t.alive = false; if (t.body) t.body.dead = true; }
    assert(d.roster.strength === 0, 'the fixture did not actually empty the roster');

    const overs = [];
    world.onGameOver = (s) => overs.push(s);
    const t = drive(world, 180, input, () => overs.length > 0);
    assert(overs.length === 1, `${overs.length} endings from one run after ${t.toFixed(0)}s`);
    assert(overs[0].won === false,
      'the run ended with every name on the fallen list and the summary says it was WON — '
      + 'that is FLAGSHIP §2 read backwards');
    assert(d.done, 'the director does not know the run is over');
    assert(world.over, 'the world is still running waves at a finished run');
    /* THROUGH THIS MODE'S OWN DOOR, and not because a lone Jedi was killed —
     * `World._checkWipe` also reports `won: false`, so without this the arm
     * would pass on a run that never tested the rule at all. */
    assert(d.log.some((r) => r.t === 'lost'), 'the run ended without this mode logging a verdict');
    world.unload();
    return `ended once at ${t.toFixed(0)}s, won=false with 0 of ${d.roster.all.length} standing`;
  });

  check('theline.4 …and the same crossing WITH survivors is a win', async () => {
    /* The other arm, and it is what makes the arm above mean something: if the
     * verdict were simply hard-wired to false the check above would pass and
     * the mode would be unwinnable. Same fixture, same path, nobody killed. */
    const { world, d, input } = await lineWorld({ trim: 2 });
    d.areaIndex = d.stages.length - 1;
    d.areaWaves = d.area.waves - 1;
    const overs = [];
    world.onGameOver = (s) => overs.push(s);
    const t = drive(world, 180, input, () => overs.length > 0);
    assert(overs.length === 1, `${overs.length} endings from one run after ${t.toFixed(0)}s`);
    assert(d.roster.strength > 0, 'the fixture lost its whole army by accident — the arm is meaningless');
    assert(overs[0].won === true,
      `a crossing finished with ${d.roster.strength} men standing came back won=${overs[0].won} — `
      + 'the mode cannot be won');
    world.unload();
    return `won with ${d.roster.strength} of ${d.roster.all.length} standing at ${t.toFixed(0)}s`;
  });

  check('theline.5 losing the army mid-crossing ends the run there', async () => {
    /**
     * THE SECOND DOOR. Before this, the only two endings in the game were
     * "every player is down" and "the last area is behind you", and an army
     * that had ceased to exist matched neither. The run went on: the muster
     * deployed nobody, the next area opened with a Jedi alone against a
     * composed wave, and the mode about a roster kept playing without one.
     *
     * The area index is deliberately NOT the last one, so nothing here can be
     * satisfied by `_endCampaign` — the run has three stages left to walk.
     */
    const { world, d, input } = await lineWorld({ trim: 2 });
    assert(!d.lastArea, 'the fixture started on the last area — this cannot tell the two doors apart');
    assert(d._landed, 'the fixture never put an army on the ground');
    const overs = [];
    world.onGameOver = (s) => overs.push(s);
    drive(world, 2, input);
    assert(overs.length === 0, 'the run ended before the army was lost');
    for (const t of d.roster.all) { t.alive = false; if (t.body) t.body.dead = true; }
    const t = drive(world, 20, input, () => overs.length > 0);
    assert(overs.length === 1, `the army was wiped out and the run produced ${overs.length} endings in ${t.toFixed(1)}s`);
    assert(overs[0].won === false, 'losing the whole army came back as a win');
    assert(d.areaIndex < d.stages.length - 1, 'the run somehow finished the crossing');
    const lost = d.log.filter((r) => r.t === 'lost');
    assert(lost.length === 1, `${lost.length} 'lost' records in the run log`);
    world.unload();
    return `ended ${t.toFixed(1)}s after the last man fell, ${d.stages.length - 1 - d.areaIndex} stages unwalked`;
  });

  check('theline.6 and Command still wins by taking the ground', async () => {
    /**
     * THE REGRESSION THIS WHOLE CHANGE COULD CAUSE. Command shipped with the
     * ground as the win, `Progress.recordRun` counts its `wins`, and a rule
     * added for a new mode that leaked into the old one would silently rewrite
     * the verdict of a mode people have already played. Same emptied roster,
     * same last area, other mode: it must still come back won.
     */
    /* AN EMPTY QUEUE, so the last area clears without anybody having to fight
     * it. The roster is dead and the Jedi is held on their feet, so there is
     * nobody left on the field to kill a wave: with the shipped two-body queue
     * the campaign simply never finished, and a check that times out proves
     * nothing about a verdict. */
    const { world, d, input } = await lineWorld({ trim: 0, mode: 'command' });
    d.areaIndex = d.stages.length - 1;
    d.areaWaves = d.area.waves - 1;
    for (const t of d.roster.all) { t.alive = false; if (t.body) t.body.dead = true; }
    const overs = [];
    world.onGameOver = (s) => overs.push(s);
    const t = drive(world, 180, input, () => overs.length > 0, true);
    assert(overs.length === 1, `${overs.length} endings from one Command campaign after ${t.toFixed(0)}s`);
    assert(d.done, `the Command campaign never reached its own ending — it ended on wave ${overs[0].wave}`);
    assert(overs[0].won === true,
      'Command stopped scoring a finished crossing as a victory — the new rule leaked into a shipped mode');
    world.unload();
    return 'the ground is still the win in Command';
  });

  check('theline.9 a run that ends alive says so, and not "you died"', async () => {
    /**
     * THE THIRD ENDING. This game had two — you won, you died — and The Line
     * has one neither describes: the run is over, the army is gone, and the
     * player is still standing on the field. `main.js` used to answer that with
     * the death card, which reports a death that did not happen over a row
     * reading "Wave reached", which is the endless modes' question.
     *
     * The discriminator is a field on the summary, set by the two doors that
     * KNOW, rather than inferred at the card from `won === false` plus a guess
     * at whether the player is breathing. Both doors are driven here, because a
     * field set by one of them and not the other is the half-wired case that
     * would show up as the wrong card in exactly the situation the mode is
     * about.
     */
    const { LINE_LOST_TITLE, VICTORY_TITLE } = await import('../../src/ui/Menu.js');
    assert(LINE_LOST_TITLE && LINE_LOST_TITLE !== VICTORY_TITLE,
      'the mode has no ending sentence of its own');

    // Door one: the army lost mid-crossing.
    const a = await lineWorld({ trim: 2 });
    let mid = null;
    a.world.onGameOver = (s) => { mid = s; };
    for (const t of a.d.roster.all) { t.alive = false; if (t.body) t.body.dead = true; }
    drive(a.world, 20, a.input, () => !!mid);
    assert(mid, 'losing the army produced no summary');
    assert(mid.ended === 'line', `the mid-crossing loss carries ended=${JSON.stringify(mid.ended)}`);
    assert(a.world.player && !a.world.player.dead,
      'the fixture killed the player too — this cannot tell the third ending from the second');
    a.world.unload();

    // Door two: the crossing finished, and finished empty.
    const b = await lineWorld({ trim: 0 });
    b.d.areaIndex = b.d.stages.length - 1;
    b.d.areaWaves = b.d.area.waves - 1;
    for (const t of b.d.roster.all) { t.alive = false; if (t.body) t.body.dead = true; }
    let end = null;
    b.world.onGameOver = (s) => { end = s; };
    drive(b.world, 180, b.input, () => !!end, true);
    assert(end, 'the empty crossing produced no summary');
    assert(end.ended === 'line', `the finished-empty loss carries ended=${JSON.stringify(end.ended)}`);
    b.world.unload();

    // …and a WIN carries no such field, or every card would be the wrong one.
    const c = await lineWorld({ trim: 2 });
    c.d.areaIndex = c.d.stages.length - 1;
    c.d.areaWaves = c.d.area.waves - 1;
    let win = null;
    c.world.onGameOver = (s) => { win = s; };
    drive(c.world, 180, c.input, () => !!win);
    assert(win && win.won === true, 'the winning arm did not win');
    assert(win.ended === undefined,
      `a won run carries ended=${JSON.stringify(win.ended)} — the card would print a defeat`);
    c.world.unload();
    return `both losing doors say "${LINE_LOST_TITLE}"; a win says nothing`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The run leaves a record                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('theline.7 the run is recorded, and a loss is not banked as a win', async () => {
    /**
     * `Progress.RECORDED` is a set of mode strings, and a mode left out of it
     * leaves no trace whatever — which for the one mode in the game whose
     * subject is a casualty list is the worst possible omission. It also has
     * to record the loss AS a loss: `recordRun` does `if (summary.won) p.wins++`,
     * so a mode that always reported true would bank a wiped army as a victory
     * in permanent storage.
     */
    const Progress = await import('../../src/game/Progress.js');
    const before = Progress.loadProgress();
    const wins0 = before.wins | 0, runs0 = before.runs | 0;
    Progress.recordRun({ mode: 'theline', won: false, wave: 3, score: 10, kills: 5, time: 200 });
    const mid = Progress.loadProgress();
    assert((mid.runs | 0) === runs0 + 1,
      `a finished run of the flagship mode was not recorded at all (${runs0} → ${mid.runs | 0})`);
    assert((mid.wins | 0) === wins0, `a LOST run was banked as a win (${wins0} → ${mid.wins | 0})`);
    Progress.recordRun({ mode: 'theline', won: true, wave: 5, score: 20, kills: 9, time: 400 });
    const after = Progress.loadProgress();
    assert((after.wins | 0) === wins0 + 1, 'a won run of the flagship mode was not counted as a win');
    return `runs ${runs0} → ${after.runs | 0}, wins ${wins0} → ${after.wins | 0}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The session shape the mode promises                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('theline.8 the sitting is a seed roll, and it reaches the mode', async () => {
    /**
     * §5: "One sitting = one deployment = one seed = one ground = 20–40 min…
     * Length is itself a seed roll." `Session.rollSession` implements it and
     * `session.mjs` holds the roll itself; what is checked HERE is that the
     * roll survives the trip through the mode — that a seeded run of The Line
     * gets the plan its seed names, and gets stages to match.
     *
     * Not asserted: which plan any particular seed draws. That is the roll's
     * own business and pinning it here would make this file fail the day the
     * weights move, which is a tuning change and not a defect.
     */
    const { SESSION_PLANS, rollSession } = await import('../../src/game/Session.js');
    const seen = new Map();
    for (const seed of [1, 2, 3, 7, 11, 19, 23, 41]) {
      const { world, d } = await lineWorld({ start: false, seed });
      const want = rollSession(d.seed);
      assert(d.plan.id === want.id,
        `seed ${seed} rolls "${want.id}" and the mode is running "${d.plan.id}"`);
      assert(d.stages.length === want.engagements,
        `a ${want.id} is ${want.engagements} engagements and the mode laid out ${d.stages.length}`);
      /* The route is drawn FROM the ground, not a second copy of it: every
       * stage has to be one of the areas the mode actually has. */
      for (const st of d.stages) {
        assert(Cmd.AREAS.includes(st), `stage "${st.name}" is not one of the mode's own areas`);
      }
      seen.set(want.id, (seen.get(want.id) | 0) + 1);
      world.unload();
    }
    assert(seen.size >= 2,
      `eight seeds drew ${seen.size} distinct length(s) — the roll is not a roll`);
    return [...seen].map(([k, n]) => `${k}×${n}`).join(' · ')
      + ` of ${SESSION_PLANS.length} plans`;
  });

  return;
}
