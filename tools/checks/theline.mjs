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
  const ground = opts.level || 'geonosis';
  const { world } = await bootWorld({
    level: ground,
    /* `spawn: false` PUTS NO JEDI ON THE FIELD AT ALL, which is one of the two
     * arms `theline.12` needs and is not the same thing as an idle one — see
     * the note there, and Levy.js's "an idle Jedi is not a Jedi; it is a corpse
     * with a delay". */
    spawn: opts.spawn !== false,
    settings: { mode: opts.mode || 'theline', level: ground, order: opts.order || 'jedi' },
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
    assert(M.fixedTheatre, 'the mode does not tell the menu the ground is not the player\'s');
    /* The GROUND is a seed roll — §5 and §13.5. `theline.11` drives the roll
     * and every ground it can land on; what is asserted here is only that the
     * mode declares it, because a mode that declares `level` instead is pinned
     * to one room and that is the Descent's mistake. */
    assert(M.seedsGround, 'the mode does not roll its ground off the seed');
    assert(!M.level, `the mode is pinned to one ground (level=${M.level}) — §13.5 says every level is a legal seed`);

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
    assert(win.ended == null,
      `a won run carries ended=${JSON.stringify(win.ended)} — the card would print a defeat`);
    c.world.unload();
    return `both losing doors say "${LINE_LOST_TITLE}"; a win says nothing`;
  });

  check('theline.11 every ground is a legal seed, and the seed picks it', async () => {
    /**
     * FLAGSHIP §13.5: "**No room's deletion deletes the mode** — every level in
     * `LEVEL_ORDER` is a legal seed. That is exactly what killed the Descent."
     *
     * The Descent was a ladder of four authored rooms, three of which the
     * player named as the worst rooms in the game, so deleting those rooms
     * deleted the mode. §13.5 asserts the cure without evidence, and this is
     * the evidence: every ground in the roster is booted IN THIS MODE and
     * required to field both sides — a full roster of named troopers on the
     * player's side and a live wave on the other. A ground that quietly stops
     * being playable narrows the mode by a seventh with nothing saying so.
     *
     * And the roll has to be a roll: a hash that returns the same ground for
     * every seed satisfies every clause above and delivers the Descent anyway.
     */
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { rollGround } = await import('../../src/game/Session.js');
    const { theatreFor, theatresFor } = await import('../../src/game/Levels.js');

    assert(theatresFor('theline').length === LEVEL_ORDER.length,
      `the mode offers ${theatresFor('theline').length} of ${LEVEL_ORDER.length} grounds`);
    const drawn = new Map();
    for (let seed = 1; seed <= 200; seed++) {
      const g = theatreFor('theline', 'geonosis', seed);
      assert(LEVEL_ORDER.includes(g), `seed ${seed} rolled "${g}", which is not a ground`);
      /* The player's `want` is ignored — every seed above asked for geonosis. */
      drawn.set(g, (drawn.get(g) | 0) + 1);
      assert(rollGround(seed, LEVEL_ORDER) === g, `theatreFor and rollGround disagree on seed ${seed}`);
    }
    assert(drawn.size === LEVEL_ORDER.length,
      `200 seeds reached ${drawn.size} of ${LEVEL_ORDER.length} grounds — the roll does not reach them all`);
    /* Seedless is not the player's pick either: a mode that says the seed owns
     * the ground must not honour a stored pick when there is no seed, which is
     * the leak `theatreFor`'s own note is about. */
    assert(theatreFor('theline', 'alpine', null) === LEVEL_ORDER[0],
      'a seedless run of the mode honoured the stored pick');

    let worst = null;
    for (const key of LEVEL_ORDER) {
      const { world, d, input } = await lineWorld({ level: key, seed: 3 });
      /* UNLOADED WHATEVER HAPPENS. A generated ground is a row in a
       * process-global preset table and `unload` is what takes it back out, so
       * a ground that fails an assertion below used to leave its row behind and
       * fail `theline.12` as well — one defect reported twice, with the second
       * report pointing at the wrong thing. */
      try {
      assert(d, `${key}: the mode built no army`);
      assert(d.roster.all.length >= 8, `${key}: the roll mustered ${d.roster.all.length}`);
      /**
       * THE COMPOSED WAVE, NOT A CENSUS OF THE FIELD.
       *
       * A count of bodies standing after N seconds is a reading of how fast
       * the fight is going — arrival pacing, the composer's budget, whatever a
       * tuning lane last moved. Measured across the roster while one was
       * mid-edit it swung from 37 to 0 on the same ground in an afternoon, and
       * a check that swings with tuning is a check nobody can act on.
       *
       * What this file is about is whether the ground is a LEGAL SEED: can the
       * mode compose a fight out of this pool at all. The queue the director
       * builds on `start` is exactly that and nothing else.
       */
      const queued = d.spawnQueue.length;
      const seen = new Set();
      for (let i = 0; i < Math.round(20 / STEP); i++) {
        world.update(STEP, input);
        for (const e of world.enemies) if (e.team !== 0) seen.add(e);
      }
      const mine = d.roster.living.filter((t) => t.body && !t.body.dead).length;
      const fielded = Math.max(queued, seen.size);
      assert(mine >= 6, `${key}: only ${mine} of the line were standing twenty seconds in`);
      /**
       * LEGAL, WHICH IS WHAT §13.5 PROMISES — and the bar is deliberately at
       * the floor rather than at a wave size.
       *
       * MEASURED, opening wave of area 1 on every ground at one seed, and the
       * spread is the finding: **colosseum 2 · scoria 3 · four grounds 8 ·
       * geonosis 49.** All seven are handed the same budget of 8.0. Two things
       * make the spread: the levy is geonosis-only, which is 40 of that 49;
       * and a pool with expensive bodies in its unlocked set spends the whole
       * budget on two or three of them — the Colosseum opens on a stalker.
       *
       * A bar of 8 here would be a bar on the wave composer, which is another
       * lane's file and moves every session; and a mode about a LINE opening
       * against two bodies is a real defect that belongs in `NEXT.md` as a
       * number, not hidden inside a red check nobody can act on. So this
       * asserts legality — the ground puts a fight on at all — and reports the
       * spread so the number stays visible.
       */
      assert(fielded >= 1,
        `${key}: the mode composed nothing at all for this ground — it is not a legal seed`);
      if (!worst || fielded < worst[1]) worst = [key, fielded];
      } finally { world.unload(); }
    }
    return `${LEVEL_ORDER.length} grounds, all legal · 200 seeds reach all ${drawn.size} `
      + `· thinnest opening ${worst[0]} at ${worst[1]} bodies`;
  });

  check('theline.13 the ground under the run is generated around a front', async () => {
    /**
     * FLAGSHIP §12: "generate the battle, then the ground that explains it."
     * `src/world/Battlefield.js` builds the battle — a reason from a table of
     * five, a bezier front from six seeded numbers, and a height closure whose
     * properties `battlefield.mjs` measures. This is the wiring, and the wiring
     * is what that module spent its life without: it had no caller.
     *
     * ── WHAT THIS ASSERTS THAT `battlefield.mjs` CANNOT ─────────────────────
     *
     * That file measures the generator. This one measures the RUN: that the
     * mode reaches it at all, that different seeds stand on different ground,
     * that a mode which did not ask for it is untouched, and — the one that
     * actually bit — that the process-global preset table does not leak.
     *
     * THE LEAK IS THE REASON THIS CHECK IS WORTH ITS SECONDS. `TERRAIN_PRESETS`
     * is module state, `installGround` refuses to shadow an existing key, and
     * `unload` did not take the generated row back out. So the FIRST world got
     * its generated ground and every world after it was refused and stood on
     * the authored one — measured, seeds 2 and 3 both came back "already a
     * ground" while seed 1 was 18.37 m up. Nothing about that is visible in a
     * single-world check, and the fallback is deliberately silent-but-warned
     * rather than fatal, so nothing would ever have failed.
     */
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const authored = [];
    const generated = [];
    const probe = (w) => [[60, -40], [-70, 30], [0, 90]]
      .map(([x, z]) => w.terrain.height(x, z));

    /* The control first: a mode that does not declare `generatedGround` stands
     * on the authored contours, whatever seed it is given. */
    for (const seed of [1, 2, 3]) {
      const { world } = await lineWorld({ start: false, mode: 'command', seed });
      assert(!world.battlefield, `command was handed a battlefield plan on seed ${seed}`);
      authored.push(probe(world));
      world.unload();
    }
    assert(authored.every((h) => h.every((v, i) => Math.abs(v - authored[0][i]) < 1e-9)),
      'the authored ground is not the same ground on every seed — the control is meaningless');

    /**
     * WHICH ROOMS DECLARE THEY CAN CARRY ONE, AND WHAT IT COSTS THE ONES THAT
     * DO NOT — measured rather than trusted, both ways.
     *
     * A generated heightfield is raised under a level's own dressing, and the
     * dressing was authored against the contours it replaces. `LEVELS[*]
     * .battlefield` is the room's own declaration that it survives that, and a
     * declaration nothing measures is a comment. So every ground is booted with
     * the layer FORCED on, deployed, and driven — and the two sets are required
     * to be what they say they are: a room that declares it must deploy its
     * line, and the report names any room that does not declare it but could.
     */
    const carries = [], breaks = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const declared = !!L.battlefield;
      const was = L.battlefield;
      L.battlefield = true;
      try {
        const { world, d, input } = await lineWorld({ level: key, seed: 3 });
        try {
          assert(world.battlefield, `${key}: forcing the layer on produced no plan`);
          for (let i = 0; i < Math.round(20 / STEP); i++) world.update(STEP, input);
          const up = d.roster.living.filter((t) => t.body && !t.body.dead).length;
          (up >= 6 ? carries : breaks).push(`${key} ${up}/10`);
          if (declared) {
            assert(up >= 6,
              `${key} declares it can carry a generated ground and only ${up} of the line were `
              + 'standing twenty seconds in — the declaration is false');
          }
        } finally { world.unload(); }
      } finally { L.battlefield = was; }
    }
    assert(carries.length >= 1, 'no ground in the game can carry a generated heightfield');

    const reasons = new Set();
    for (const seed of [1, 2, 3, 4, 5]) {
      const { world } = await lineWorld({ start: false, seed });
      const plan = world.battlefield;
      assert(plan, `seed ${seed} got no battlefield plan — the mode is standing on authored ground`);
      assert(plan.reason && plan.curve, `seed ${seed}'s plan has no reason or no front`);
      reasons.add(plan.reason.id ?? String(plan.reason));
      const h = probe(world);
      assert(h.some((v, i) => Math.abs(v - authored[0][i]) > 0.5),
        `seed ${seed} generated a ground indistinguishable from the authored one`);
      generated.push(h);
      /* THE LEVEL IS STILL THE LEVEL. §12.5 and §13.5 together: only the height
       * is replaced, so the pool, the name and the dressing are the authored
       * room's and nothing generated is reachable except through it. */
      assert(world.level === LEVELS.geonosis,
        `seed ${seed} landed on something that is not the authored level`);
      world.unload();
    }
    assert(reasons.size >= 2,
      `five seeds drew ${reasons.size} distinct reason(s) — the table of five is not being drawn from`);
    /* Different seeds, different ground. Without this the leak above passes:
     * every world would report a plan and stand on identical contours. */
    const distinct = new Set(generated.map((h) => h.map((v) => v.toFixed(3)).join()));
    assert(distinct.size === generated.length,
      `${generated.length} seeds produced ${distinct.size} distinct grounds — the preset table is leaking `
      + 'between worlds and all but the first fell back');

    /* …AND IT IS TAKEN BACK OUT. A row left in a process-global table outlives
     * the world that made it, which is what caused the leak in the first place. */
    const { TERRAIN_PRESETS } = await import('../../src/world/Terrain.js');
    const left = Object.keys(TERRAIN_PRESETS).filter((k) => k.startsWith('front:'));
    assert(!left.length, `unload left ${left.join(', ')} in the shared preset table`);
    return `${reasons.size} reasons over 5 seeds, ${distinct.size} distinct grounds, table clean · `
      + `carries: ${carries.join(' ')} · breaks: ${breaks.join(' ') || 'none'}`;
  });

  check('theline.10 nothing arrives closer than you could have watched it come', async () => {
    /**
     * FLAGSHIP §5, the 0:32 beat: "First contact walks in over the far edge.
     * Nothing spawns near you that you could not have watched arrive."
     *
     * This is the single property that separates a battlefield from a wave
     * arena, and it is the one a composer change can silently break — a pool
     * gaining a body whose spawn ring is written for a colosseum, a queue that
     * falls back to "near the player" when a placement fails. Neither would
     * fail any other check in the suite.
     *
     * The bar is 40 m and the shipped run clears it by a wide margin: measured
     * over a real minute of a seeded Line on geonosis, 49 hostiles appeared,
     * the NEAREST at 70.0 m and the median at 147.1 m. The bar is set well
     * under the measurement on purpose — what is being defended is the
     * property, not the tuning, and a check pinned at 70 would fail the day
     * somebody moves a spawn ring by a metre.
     */
    const NEAR = 40;
    const { world, d, input } = await lineWorld({ seed: 7 });
    const seen = new Set();
    let closest = Infinity, worst = null, n = 0, total = 0;
    const watch = () => {
      for (const e of world.enemies) {
        if (seen.has(e) || e.team === 0) continue;
        seen.add(e); n++;
        const p = world.player.position;
        const dist = Math.hypot(e.position.x - p.x, e.position.z - p.z);
        total += dist;
        if (dist < closest) { closest = dist; worst = e.type; }
      }
    };
    for (let i = 0; i < Math.round(60 / STEP); i++) { world.update(STEP, input); watch(); }
    assert(n >= 20, `only ${n} hostiles appeared in a minute — nothing was measured`);
    assert(closest >= NEAR,
      `a ${worst} appeared ${closest.toFixed(1)} m from the player — inside ${NEAR} m is a body `
      + 'that did not walk in from anywhere');
    const mean = total / n;
    world.unload();
    return `${n} hostiles · nearest ${closest.toFixed(1)} m · mean ${mean.toFixed(0)} m`;
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

  /* ══════════════════════════════════════════════════════════════════ */
  /*  What one engagement costs                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('theline.12 an engagement fought without the Jedi costs about half the line', async () => {
    /**
     * THE TARGET IS THE PLAYER'S, IN THEIR OWN WORDS: "an engagement fought
     * with no help from the Jedi should cost roughly HALF a ten-man line —
     * about 5 of 10. So the muster matters, and the player's presence is the
     * difference between holding and folding."
     *
     * This is the only thing in the tree that binds it. Until §16.3 was fixed
     * `World._boltHitTest` skipped its entire enemy loop for hostile bolts and
     * your own troopers live in that array, so no rifle on the other side could
     * touch your army and every number ever taken about the line's survival
     * described a line that could not be shot. The rate at which it can now be
     * shot is a tuning surface with nothing standing on it, and a mode scored
     * on survivors cannot afford that: at one end the roster is gone before the
     * first muster and the mode is unwinnable, at the other nobody dies and the
     * name list — §13's second spine, "it only shrinks and it is on the HUD
     * every second" — never moves.
     *
     * ── FOUR THINGS THE FIXTURE HAS TO GET RIGHT, EACH OF WHICH WAS WRONG
     *    IN AN EARLIER READING ───────────────────────────────────────────
     *
     * ONE ENGAGEMENT IS ONE AREA. `stages[0]` is three waves and the muster is
     *   what an area boundary opens; a per-wave reading prices a third of the
     *   thing the target is about.
     *
     * THE MUSTER MUST BE HELD OPEN TO BE SEEN AT ALL. `_areaClear` ends with
     *   "no screen wired: muster for the player and press on" — `autoMuster()`
     *   then `closeMuster()`, both inside one `payWave` call — so `mustering`
     *   is true for less than a frame and a poll for it never fires. Every
     *   reading taken that way ran on into area 2 and reported the roster at
     *   whatever wipe it eventually hit, which is where "the roster is wiped in
     *   wave 1 and the muster is unreachable" came from. A no-op `onMuster` is
     *   what a player's screen is to the director.
     *
     * THE ARM IS NO PLAYER AT ALL, AND NOT AN IDLE ONE. Measured over the same
     *   five seeds: a line with nobody on the field holds four areas of five;
     *   the same line with an idle player standing in it is wiped on five of
     *   five. An idle Jedi held on his feet is an unkillable target on the
     *   deploy mark and `Levy.installLevyAim` points forty conscripts at
     *   whatever blade is on the field, so that arm measures a magnet rather
     *   than an absence. Levy.js: "an idle Jedi is not a Jedi; it is a corpse
     *   with a delay."
     *
     * GEONOSIS, NAMED. The mode rolls its ground off the seed (theline.11) and
     *   this is the only one carrying the levy and the gun pit — the two
     *   sources of fire the wave's threat budget never pays for, and five of
     *   the eight names an engagement costs. A check that let the seed choose
     *   would average seven different fights and report the mean as one.
     *
     * ── WHY THE BAND IS THIS WIDE, WHICH IS A MEASUREMENT AND NOT A HEDGE ──
     *
     * Run-to-run spread on this fixture is enormous and it is not the harness:
     * a single engagement is one composed wave meeting one formation, and one
     * grenade or one Hailfire arriving early is two or three names. Seventeen
     * engagements of this arm on the tuned build — five from
     * `tools/_linehold.mjs`, five of Command's, and every one this check has
     * itself taken — came back
     *
     *     4 6 6 3 8 · 7 10 0 · 1 1 3 5 5 · 0 0 3 7    mean 4.1, sd 3.0
     *
     * with two engagements in which nobody died at all and four wiped out. A
     * four-seed mean therefore carries a standard error near 1.5.
     *
     * ── AND THE MEAN ITSELF SWINGS, WHICH IS THE FACT THAT SET THIS BAND ───
     *
     * The first cut of this check asserted ±2.5 on a standard error estimated
     * at 1.2 from five-seed arms taken inside ONE process, and that estimate
     * was of the wrong population. Five independent runs of this arm on the
     * same code read
     *
     *     5.4 · 6.0 · 5.7 · 3.0 · 2.5          the MEAN, sd 1.6
     *
     * — 6.0 and 2.5 an hour apart with nothing changed between them, because
     * `World.js` held one module-level `rng` for the whole process and exported
     * no reseeder, so the phase this check started from was whatever the eleven
     * checks above it had left behind.
     *
     * THAT ONE IS FIXED AT THE SOURCE rather than absorbed here: `seedWorld`
     * exists now and the loop below pins all THREE of the game's streams per
     * seed. What is left in the band is the spread this fixture has when it is
     * genuinely repeated, and the quantity is chaotic rather than merely
     * noisy — two arms differing only in one bolt's damage, 10 against 5, took
     * the same seed from five survivors to one and the next from one to five.
     *
     * So `HALF` is the target and `SLACK` is a little over two standard errors
     * either side. The band is wide, and saying what it therefore does NOT
     * catch is more useful than pretending otherwise: it will not see a
     * two-name drift, and it is not the instrument for tuning — that is
     * `tools/_linehold.mjs`, five seeds, one arm, one process. What it does
     * catch is the pair of failures that make the mode a different game, and
     * both sit far outside it: an army gone before its first muster, and an
     * engagement nobody dies in. **A single red here is worth re-running
     * before it is believed** (HANDOFF §2.5, from the other side).
     *
     * The seeds are named rather than rolled for the reason `theline.11`'s
     * ground sweep names its own: a check that draws a fresh seed each run
     * reports a different number every time it is looked at. Their absolute
     * values are NOT reproducible against `tools/_linehold.mjs` seed for seed —
     * `World.js` holds one module-level `rng` for the whole process and exports
     * no reseeder, so the phase depends on everything that ran before — which
     * is the other half of why this asserts a band on a mean rather than a
     * figure on a run.
     */
    const HALF = Cmd.OPENING_STRENGTH / 2;
    const SLACK = 4.0;
    const SEEDS = [1, 2, 3, 5];
    const { enemyRng } = await import('../../src/game/Enemy.js');
    /* DYNAMIC, for the reason HANDOFF §2.1 gives about this file in
     * particular: a static edge from a check to World.js patches the copy of
     * three that verify.mjs's own graph resolved. */
    const { seedWorld } = await import('../../src/game/World.js');
    /**
     * …AND THE CONTOURS ARE HELD STILL, which is the one thing this fixture
     * takes off the shipped configuration and the reason is that this check is
     * about ATTRITION and not about ground.
     *
     * `LEVELS.geonosis.battlefield` raises a heightfield generated around a
     * bezier front for the run seed under the level's own dressing (FLAGSHIP
     * §12, `theline.13`), so with it on, the ground a seed stands on is a
     * second variable inside a number that already has a standard deviation of
     * three. It would also make this check fail on the terrain lane's commits
     * and read as their fault.
     *
     * MEASURED BOTH WAYS BEFORE PINNING, so the pin is not hiding anything:
     * the tuned build reads 5.4 of 10 over five seeds on the authored contours
     * (`tools/_linehold.mjs`) against 5.7 and 6.0 over three seeds apiece on
     * generated ones — the same mean inside the noise. What the layer moves is
     * the SPREAD, not the level, so pinning costs this check no fidelity about
     * the thing it is measuring and buys it a fixture that does not move under
     * somebody else's work.
     */
    const GROUND = LEVELS.geonosis;
    const wasField = GROUND.battlefield;
    GROUND.battlefield = false;
    const rows = [];
    try {
    for (const seed of SEEDS) {
      /* From a stated phase, the same way `levy.mjs` does it, so this check at
       * least agrees with itself between runs of the suite. XORed with a large
       * constant because the seeds are literally 1, 2, 3 and adjacent small
       * seeds put this stream in nearly the same place. */
      enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
      Waves.seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
      seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
      const { world, d, input } = await lineWorld({ seed, spawn: false });
      d.onMuster = () => {};
      assert(d.roster.strength === Cmd.OPENING_STRENGTH,
        `seed ${seed}: the roll mustered ${d.roster.strength}`);
      const t = drive(world, 600, input,
        () => d.mustering || world.over || d.roster.strength === 0);
      const kills = d.roster.all.reduce((n, x) => n + x.kills, 0);
      /* THE LINE HAS TO HAVE FOUGHT. A survivor count off a line nothing
       * reached is a reading about a quiet corner, which is the same trap
       * `command.mjs`'s fire-discipline check names when it insists its
       * reference condition is a firefight at all. */
      assert(kills > 0,
        `seed ${seed}: ${d.roster.strength} of ${Cmd.OPENING_STRENGTH} stood for ${t.toFixed(0)}s `
        + 'without the line killing anything — this fixture is not an engagement');
      rows.push({ seed, left: d.roster.strength, t, kills, held: !!d.mustering });
      world.unload();
    }
    } finally { GROUND.battlefield = wasField; }
    const left = rows.map((r) => r.left);
    const mean = left.reduce((a, b) => a + b, 0) / left.length;
    const held = rows.filter((r) => r.held).length;
    assert(mean >= HALF - SLACK,
      `${SEEDS.length} engagements fought with no Jedi on the field left ${mean.toFixed(1)} of `
      + `${Cmd.OPENING_STRENGTH} standing on average [${left.join(' ')}] — the target is about half `
      + 'a line, and a line this far under it means the muster is never reached and the mode cannot '
      + 'be won. The two things to look at first are the sources of fire the wave\'s threat budget '
      + 'does not pay for: src/game/Emplacement.js and src/game/Levy.js.');
    assert(mean <= HALF + SLACK,
      `${SEEDS.length} engagements with no Jedi on the field left ${mean.toFixed(1)} of `
      + `${Cmd.OPENING_STRENGTH} standing [${left.join(' ')}] — an engagement nobody dies in makes `
      + 'the name list decoration and the muster a screen with nothing on it. FLAGSHIP §13 calls '
      + 'that list the mode\'s second spine on the grounds that it only ever shrinks.');
    /* AND THE AREA HAS TO BE REACHABLE, which is the half of the target the
     * mean cannot state: a run that is wiped in wave 2 and one that holds the
     * ground with two men both leave a small number standing. */
    assert(held >= 1,
      `none of ${SEEDS.length} engagements reached its muster — the between-areas beat the mode is `
      + 'built around is unreachable in play whatever the survivor count says');
    return rows.map((r) => `seed ${r.seed}: ${r.left}/${Cmd.OPENING_STRENGTH} in ${r.t.toFixed(0)}s`
      + `${r.held ? '' : ' (wiped)'}`).join(' · ')
      + ` — mean ${mean.toFixed(1)} against a target of ${HALF} ± ${SLACK}, ${held}/${SEEDS.length} held`;
  });

  return;
}
