/**
 * BATTLEFRONT BORZ — Command: an army with names on it.
 *
 * Player note #21 is the biggest single thing on their list, and almost every
 * clause of it is a property rather than a feature — which is what makes it
 * checkable. "your troops when dead will permanently die unless they are
 * replaced" is a property. "every ally has a unique name you can see" is a
 * property. "the specific troopers that survive get more experience as they live
 * and get stronger themselves too" is three. And note #29 — "your allies should
 * be as real as the enemies like NO DIFFERENCE … but obviously the force
 * blaster-stop thing shouldn't affect your allies' blasters" — is a pair of
 * properties that pull against each other, which is exactly the pair a checker
 * should be pointed at.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED HERE ──────────────────────────────
 *
 * Anything about how the mode FEELS. There is no check that a formation looks
 * good, that a promotion is satisfying or that losing a name hurts. Those are
 * the things HANDOFF §7 says a person has to play the game to find out, and a
 * number invented to stand for one of them would be a number about the harness.
 *
 * What IS asserted is the set of sentences that can silently become false: a
 * name that is not unique, a rank that only exists in a list, a formation whose
 * leash does nothing, an ally a Force push cannot reach, a wave that cannot end.
 */

import * as THREE from 'three';
import * as Cmd from '../../src/game/Command.js';
import * as Waves from '../../src/game/Waves.js';
import { ARCHETYPES, Enemy, enemyRng } from '../../src/game/Enemy.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TEAM, canHarm } from '../../src/game/Player.js';
import { CORPSE_BUDGET, Corpses } from '../../src/game/Corpses.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── fixtures ────────────────────────────────────────────────────────── */

const flatGround = (opts = {}) => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, surfaceAt: () => 'sand', crater() {}, flush() {},
  slopeAt: () => 0,
  inBounds: (x, z) => Math.hypot(x, z) < (opts.bound ?? 200),
});

/**
 * A world with the fields the command director actually reads.
 *
 * Bodies are stubs rather than real `Enemy`s on purpose: what this file is about
 * is the ROSTER, the formations and the rules, and a real Enemy drags in a rig,
 * a ragdoll, cloth and a physics body for every one of twenty-four troops. The
 * stub carries exactly the fields the director touches — which is also a useful
 * assertion in itself, because a director that quietly started reading a
 * fifteenth field would fail here rather than in a browser.
 */
function cmdWorld(opts = {}) {
  const w = {
    scene: new THREE.Scene(),
    terrain: flatGround(opts),
    settings: opts.settings || {},
    difficulty: null, hpScale: 1, dmgScale: 1,
    players: [], enemies: [], statics: [], props: [], doors: [],
    /* `staticBoxes` is what TAKE COVER looks through for something to get
     * behind (`_coverSite`), so a stub without it turns that half of the order
     * off silently rather than failing. */
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {},
      addStaticBox() { return null; }, removeStaticBox() {}, raycast: () => null },
    level: LEVELS.geonosis,
    run: null, takenBoons: new Set(),
    notes: [],
    notify(a, b) { this.notes.push([a, b]); },
    report() {},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type];
      const e = {
        id: 'e' + (w._n = (w._n | 0) + 1), type, A, world: w, team: 1,
        position: pos.clone ? pos.clone() : V(pos.x, pos.y, pos.z),
        velocity: new THREE.Vector3(), dead: false, hp: A.hp, maxHp: A.hp,
        speed: A.speed, attackDamage: A.damage ?? 0, mod: null, rig: null,
        group: null, wish: null, toTarget: null, facing: 0,
        _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0,
        _prevPos: new THREE.Vector3(),
        burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
        _move(dt) { this._moved = (this._moved | 0) + 1; },
        damage(n) { this.hp -= n; this._took = (this._took || 0) + n; return this.hp <= 0; },
        _syncBody() {},
      };
      w.enemies.push(e);
      return e;
    },
  };
  return w;
}

const dirFor = (opts = {}) => {
  const w = opts.world || cmdWorld(opts);
  const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool, army: opts.army });
  return { w, d };
};

/**
 * A DEPLOYED ARMY WITH A BODY TO COMMAND IT, AND ITS SQUAD NUMBERS STAMPED.
 *
 * Three things the delegation checks all need and none of which `dirFor` does:
 *
 *   A PLAYER. `_frame` reads `c.player.position`, and the stub has only
 *     `players` — without this every frame falls back to the anchor and a check
 *     about where a squad forms measures a formation nobody is standing in.
 *   BODIES. `deploy()` builds one per living record.
 *   ONE TICK. `cmdSquad`, `cmdIndex` and `cmdCount` are written by `_troops`,
 *     so a slot solved cold is every trooper's slot zero — and `slotFor` and
 *     `lineGathered` both read `cmdSquad` to find which squad's ground a man
 *     belongs to. A check run without this tick would put the whole army in
 *     squad 0 and pass for the wrong reason.
 */
function delegated(opts = {}) {
  const { w, d } = dirFor(opts);
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
  w.players.push(me);
  w.player = me;
  d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  return { w, d };
}

/* ── the real thing ──────────────────────────────────────────────────── */

/**
 * A REAL COMMAND WORLD, DEPLOYED AND RUNNING — and it is the only fixture below
 * this line, on purpose.
 *
 * `cmdWorld` above is a stub. It was the right shape for what it was written to
 * ask (is the roster unique, does the rank ladder climb, is the leash gate a
 * gate) and it is INCAPABLE of asking anything else, because nothing in it
 * fights: `spawnEnemy` returns an object with a `_move` that increments a
 * counter, so no body has ever walked, aimed, fired or died inside this file.
 *
 * That is why this suite was 15/15 green across two crashes, an advance that
 * never ended, a win that could not be recorded, permadeath that fired zero
 * times in 66 minutes, a leash that produced 0 kills from ten troopers in 70 s
 * and a liveness watchdog that dismantled the formation it was asked to protect
 * 19 times in 88 s. Every one of those is a fact about a world stepping, and a
 * suite made of tables and stubs cannot see a single one.
 *
 * So: a real `World` on the real ground, the army deployed through
 * `world.spawnEnemy`, and `world.update` as the only clock. It costs about
 * thirty seconds a check and that is the price of a check that could fail.
 *
 * `trim` cuts the composed wave down to a few bodies. The wave is still composed
 * by the shipped composer and delivered by the shipped arrivals — this only
 * shortens the queue, so a check that has to reach a CLEAR reaches one in forty
 * game-seconds instead of two hundred.
 */
async function commandWorld(opts = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  /**
   * THE TWO STREAMS `clocked` DOES NOT PUT BACK, stated by the checks that
   * need them stated.
   *
   * `restoreShared` covers `enemyRng`, `duelRng` and `commandRng`. It does NOT
   * cover Waves' stream — `_shared.mjs` says so, and says why: the seed is part
   * of what a wave check is measuring — and it does not cover `World.js`'s one
   * module-level `rng` either. A fixture that boots a real world and drives it
   * therefore inherits both from whatever ran before it in the process.
   *
   * For most of this file that is harmless: the checks read structure, orders
   * and interventions, which do not care which wave turned up. For the ones
   * that read ATTRITION it is the whole answer. The watchdog check bounds the
   * roster at fewer than five of ten lost; it reads none at all alone, five
   * after `colosseum` and `command-pvp`, and seven inside the full suite — the
   * same code, three answers, and none of them about the watchdog. It is a
   * tripwire on unrelated work rather than a gate on this one, and it went off
   * on a change to the levy that can only ever make the enemy FIRE LESS.
   *
   * OPT-IN, because pinning it for every check in this file is re-tuning the
   * file to fix one fixture: the first seed tried turned "the last wave of the
   * area did not pay" red instead. So the checks that measure attrition name a
   * seed and the rest are left exactly as they were. Named rather than rolled,
   * for `theline.11`'s reason — a fixture that draws a fresh one reports a
   * different number every time it is looked at.
   */
  if (opts.waveSeed != null) {
    const { seedWaves } = await import('../../src/game/Waves.js');
    const { seedWorld } = await import('../../src/game/World.js');
    seedWaves(opts.waveSeed);
    seedWorld?.(opts.waveSeed);
  }
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: opts.order || 'jedi' },
  });
  const d = world.command;
  if (d && opts.formation) d.order(opts.formation);
  if (d && opts.start !== false) {
    world.director.start(1);
    if (opts.trim) d.spawnQueue.length = Math.min(d.spawnQueue.length, opts.trim);
  }
  return { world, d, input: idleInput() };
}

/**
 * Step a real world.
 *
 * 1/30 rather than 1/60 because these drives are forty to ninety GAME-seconds
 * long and this box renders through swiftshader — HANDOFF §2.6. `main.js`
 * clamps `dt` at 0.1 s, so 0.033 is inside the range the game is written to
 * survive, and both halves of every A/B below were measured at it.
 */
const STEP = 1 / 30;
function drive(world, seconds, input, until = null) {
  const n = Math.round(seconds / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    world.update(STEP, input);
    t += STEP;
    if (until && until(t)) break;
  }
  return t;
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  /* ══════════════════════════════════════════════════════════════════ */
  /*  The mode and its ground                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: the mode owns its ground, and says so where the menu reads it', async () => {
    const M = Waves.MODES.command;
    assert(M, 'there is no `command` mode');
    assert(typeof M.name === 'string' && M.name.length, 'the mode has no name');
    /* The whole point of the field. `Menu._syncTheatre` greys the Theatre column
     * when a mode declares one and prints THIS STRING beside it; without it all
     * eight level cards stay live, write `settings.level`, save it, and the
     * write leaks into the next run of another mode. That is not hypothetical —
     * it is exactly what the Descent did, and menu.mjs's own note names Command
     * as the mode that would walk back into it. */
    assert(typeof M.fixedTheatre === 'string' && M.fixedTheatre.length > 20,
      'command does not declare fixedTheatre, so the Theatre column stays live and writes');
    assert(LEVELS.geonosis && LEVEL_ORDER.includes('geonosis'),
      'the mode owns a ground the roster does not have');
    assert(TERRAIN_PRESETS.geonosis, 'geonosis names a terrain preset that does not exist');

    /**
     * …AND THE MODE ACTUALLY LANDS THERE, which is the half every assertion
     * above this line was incapable of seeing.
     *
     * This check used to end here and return "Command → Geonosis, theatre
     * fixed" — a CONCLUSION IT HAD NOT MEASURED, and which was false. What it
     * verified was that a mode existed, that its name was a string, that a
     * sentence was longer than twenty characters, and that a level was present
     * in a table. Meanwhile `deploy()` read the player's last-picked level and
     * `DEFAULT_SETTINGS.level` is `'scoria'`, so the default path put the army
     * on the Ember Shelf — with scoria's pool, so none of the seven Command
     * units or four machines could even spawn.
     *
     * A green check printed the opposite of the truth for the entire life of
     * the feature. So the rule is now CALLED rather than restated (HANDOFF
     * §2.4): build a real World the way the game builds it, ask for a
     * deliberately wrong level, and read back where it actually stood up.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'colosseum',                    // deliberately NOT geonosis
      settings: { mode: 'command', level: 'colosseum' },
    });
    assert(world.levelKey === 'geonosis',
      `Command deployed onto '${world.levelKey}' after being asked for 'colosseum'. `
      + 'The mode declares fixedTheatre and MODES.command.level; if nothing on the load '
      + 'side reads them, the menu greys the Theatre column and then lies about the ground.');
    const got = world.levelKey;
    world.unload();
    return `${M.name} → ${LEVELS.geonosis.name}; asked for kamino, stood up on ${got}`;
  });

  check('command: the meeting is Command\'s, and it cannot empty another mode', () => {
    /**
     * `commandConfig`'s `versus` means "the other army is a PERSON's, deployed
     * rather than composed", and `CommandDirector.start` implements it by not
     * composing a wave at all. The box that sets it is a GLOBAL settings key,
     * and `World.loadLevel` builds a CommandDirector for `command`, `skirmish`
     * AND `campaign` — so a player who ticked the meeting box in Command and
     * then started a Skirmish got a battle with no opposing army in it, and a
     * campaign mission that cleared itself the moment it opened. Measured on
     * geonosis: the opening spawn queue was 8 bodies with the box clear and 0
     * with it ticked, in all three modes.
     *
     * DERIVED FROM THE MODE TABLE, not from a list of names here: the modes
     * that can hold a meeting are the ones declaring `meeting`, so this clause
     * covers a mode that does not exist yet. It also holds the other end — the
     * mode that DOES declare it must still get its meeting, or the fix would be
     * "turn the feature off" wearing a different hat.
     *
     * …AND THE THIRD COLUMN IS "TICKED, WITH NOBODY TO MEET", which is the
     * shape the player actually hit: the box is persisted, so it outlives the
     * session it was ticked in. Every mode, Command included, must field
     * exactly what it fields with the box clear — see `meetingOpposed`. The
     * mode-isolation clause above could never see it, because its own fixture
     * was always alone and it read Command's empty queue as correct.
     */
    const L = LEVELS.geonosis;
    const stub = (mode, versus, session) => ({
      enemies: [], players: [], difficulty: null, takenBoons: new Set(), level: L,
      /* The one fact `meetingOpposed` asks the world for when nobody is
       * standing on the field yet. `connected` is the field `World.attachNet`
       * puts there and the shape `bootPair` builds, so this is the question the
       * game asks and not a paraphrase of it. */
      net: session ? { connected: true } : null,
      notify() {},
      settings: { mode, level: 'geonosis', order: 'jedi', commandVersus: versus },
    });
    /* AN A/B ON THE BOX, PER MODE, rather than a bar on the queue length. Some
     * modes compose nothing of their own — `sandbox` opens empty and is
     * supposed to — so "did it field anything" cannot tell a mode minding its
     * own business from a mode that a Command box just emptied. What can is
     * whether ticking the box CHANGED anything: outside Command it must not. */
    const open = (mode, versus, session = true) => {
      const d = new Cmd.CommandDirector(stub(mode, versus, session), { pool: L.pool, seed: 1234 });
      d.start(1);
      return { versus: d.versus, queue: d.spawnQueue.length };
    };
    /**
     * FOUR RUNS PER MODE, NOT THREE, and the fourth is what a mode of its own
     * needed.
     *
     * The A/B used to be "the box on against the box off, both in a session",
     * with the alone run compared against the box-off one. That comparison has
     * two variables in it — the box AND the session — and it was exact for
     * exactly as long as the box was the only way to reach a meeting. It is not
     * any more: `MODES.versus` carries `alwaysVersus`, so its box-off run is
     * still a meeting, and the old line read a mode whose whole subject is the
     * meeting as "a Command setting emptied this one".
     *
     * So the box is A/B'd against ITSELF at each session state, which is the
     * property the paragraph above always meant: ticking a Command box must not
     * change what any mode fields when there is nobody to meet.
     */
    const out = [];
    for (const mode of Object.keys(Waves.MODES)) {
      const M = Waves.MODES[mode];
      const off = open(mode, false), on = open(mode, true);
      const aloneOff = open(mode, false, false), alone = open(mode, true, false);
      const wants = !!M.meeting;
      assert(on.versus === wants,
        `${mode} reads the meeting box as ${on.versus} where its own entry says ${wants}`);
      /* A MODE THAT DECLARES ITSELF A MEETING NEEDS NO BOX. The other half of
       * `alwaysVersus`: a card called Commander Battle that fights a composed
       * wave because a checkbox on the Command panel was never ticked is the
       * defect the mode was made to end. */
      assert(!M.alwaysVersus || off.versus === true,
        `${mode} declares alwaysVersus and reads as a campaign with the Command box clear`);
      /* THE STICKY BOX, IN A RUN WITH NO SESSION. Every mode, no exceptions:
       * with nobody to meet the box is not a mode switch, it is nothing. */
      assert(alone.versus === false,
        `${mode} held a meeting with no session and no second player — versus stayed true`);
      assert(alone.queue === aloneOff.queue,
        `${mode} fields ${aloneOff.queue} bodies with the meeting box clear and ${alone.queue} with `
        + 'it ticked in a run that has nobody to meet. The box is a persisted global; a player who '
        + 'ticked it in a session last week must still get a battle today.');
      if (wants) {
        /* WITH SOMEBODY TO MEET, NOTHING IS COMPOSED — the other army is a
         * person's. WITH NOBODY, there is a battle rather than an empty plain.
         * Stated against the SESSION rather than against the box, so it holds
         * for a mode that has no box to compare. */
        assert(on.queue === 0,
          `${mode} declares a meeting and composed ${on.queue} bodies anyway — the other army is `
          + "supposed to be a person's");
        assert(alone.queue > 0,
          `${mode} stood its meeting down with nobody to meet and then composed nothing — that is `
          + 'the empty plain the stand-down exists to prevent');
        out.push(`${mode} meets, alone ${alone.queue}`);
      } else {
        assert(on.queue === off.queue,
          `${mode} fields ${off.queue} bodies normally and ${on.queue} with a COMMAND box ticked — `
          + 'a setting from another mode is emptying this one');
        out.push(`${mode} ${off.queue}`);
      }
    }
    return out.join(', ');
  });

  check('command: a meeting with nobody to meet is a battle, not an empty field', async () => {
    /**
     * THE PLAYER'S OWN REPORT, AS A NUMBER, AND IT IS THE ONE NUMBER HE GAVE:
     * "no in the mode I was playing it said 0 hostiles the entire time / it was
     * in command mode not versus".
     *
     * `opt-command-versus` is a PERSISTED GLOBAL. Ticked once — in a session,
     * where it is exactly right — it is still ticked in every solo Command run
     * afterwards, and a meeting's opposing army is deployed by a PERSON rather
     * than composed. Measured on the shipped build through the same two calls
     * `main.js` makes after the world stands up: opening spawn queue 0 bodies,
     * `hostilesLeft` 0 at 30 s and 0 at 60 s, and the run cannot end because
     * there is nothing on the field to clear.
     *
     * WHY THIS IS A DRIVE AND NOT A FLAG READ. A check that asserted `versus`
     * would have been GREEN throughout: the flag was correct — the player asked
     * for a meeting and `MODES.command.meeting` says Command may hold one — and
     * the defect was entirely in the consequence. So the assertion is the
     * hostile count off the same `hostilesLeft` the HUD prints, on a real
     * World, sixty game-seconds deep.
     *
     * A/B AGAINST THE SAME RUN WITH THE BOX CLEAR, so "there is a fight" is
     * measured against the fight the mode gives anyway rather than against a
     * number typed here. Same `runSeed`, so both arms compose the same wave.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { hostilesLeft } = await import('../../src/ui/HUD.js');
    const arm = async (box) => {
      const { world } = await bootWorld({
        level: 'geonosis', runSeed: 7,
        settings: { mode: 'command', level: 'geonosis', order: 'jedi', commandVersus: box },
      });
      /* VERBATIM THE TWO LINES main.js RUNS once the world is standing and the
       * net (if any) is attached. Calling `director.start(1)` directly would
       * skip `beginVersus`, which is the door the whole defect came through. */
      if (world.command?.versus) world.beginVersus();
      else world.director.start(1);
      const input = idleInput();
      let t = 0, at30 = null, empty = 0, peak = 0;
      for (let i = 0; i < Math.round(60 / STEP); i++) {
        world.update(STEP, input);
        t += STEP;
        const h = hostilesLeft(world);
        peak = Math.max(peak, h);
        if (h === 0) empty++;
        if (at30 === null && t >= 30) at30 = h;
      }
      const r = { versus: world.command.versus, wave: world.command.wave,
        at30, at60: hostilesLeft(world), peak, empty };
      world.unload();
      return r;
    };
    const off = await arm(false), on = await arm(true);

    assert(on.at30 > 0,
      `0 hostiles 30 s into a solo Command run with the meeting box ticked (${off.at30} with it `
      + 'clear). This is the player\'s report verbatim: the field is empty and stays empty.');
    assert(on.versus === false,
      'a solo Command run with the meeting box ticked is still calling itself a meeting. '
      + '`update` skips the entire wave loop on that flag, so a wave composed under it would '
      + 'never drain its queue — the flag has to be cleared, not worked around.');
    /* …AND THE FIELD FILLED AT ALL, which is the blunt form of the report and
     * the one number that was 0 for the whole life of the defect. */
    assert(on.peak > 0,
      'the field never held a single hostile in 60 s of a solo Command run');
    /**
     * HOW MUCH OF THE MINUTE THERE WAS NOBODY THERE — and this is the clause
     * that carries the 60 s half of the report.
     *
     * NOT an equality against the control, and not one on the count at 60 s.
     * Both arms are the same seeded wave against the same army and they finish
     * it within a body or two of each other, but WHICH body dies on which frame
     * is combat rather than composition, and a wave CLEARED leaves an empty
     * field until the next one composes. Measured across runs: 0 to 61 empty
     * frames in either arm, with the two arms swapping which was higher. So the
     * bar is a quarter of the run, which is a fight that stopped being one —
     * and it is 1800 of 1800 with the defect in, which is what it is for.
     */
    assert(on.empty <= 450,
      `${on.empty} frames of 1800 with an empty field (${off.empty} in the same seeded run without `
      + 'the box) — the fallback is not the fight the mode gives anyway');
    /* …AND IT IS THE SAME SIZE OF FIGHT. A fallback that composed two bodies
     * would satisfy every clause above and still be a different mode. Measured
     * 50 and 50; the 0.8 is slack for whose body died on which frame, not for a
     * smaller wave — a token fallback would land at 2 against 50. */
    assert(on.peak >= off.peak * 0.8,
      `peak ${on.peak} hostiles with the box against ${off.peak} without it`);
    return `box clear ${off.at30}@30s ${off.at60}@60s (peak ${off.peak}, ${off.empty} empty frames); `
      + `box ticked ${on.at30}@30s ${on.at60}@60s (peak ${on.peak}, ${on.empty}), `
      + 'meeting stood down';
  });

  check('command: geonosis is FLAT where you fight and has something to see everywhere', () => {
    /**
     * THE ONE PROPERTY THE WHOLE MODE RESTS ON, as a number.
     *
     * Every other level in this game is a bowl, a cirque, a wash or a hall — a
     * shape that gives one Jedi somewhere to fall back to. A LINE OF TROOPS
     * CANNOT FORM IN A GULLY, and "circle around me" on a slope is not a circle.
     * So the fighting ground has to be as flat as the flattest ground the game
     * has and stay that way far enough out to array an army on.
     *
     * Measured against the arena's fighting floor, which is that flattest
     * ground, over the same inner disc.
     */
    const P = TERRAIN_PRESETS.geonosis, A = TERRAIN_PRESETS.arena;
    const fract = (v) => v - Math.floor(v);
    const measure = (Q, R) => {
      const half = Q.scale / 2;
      let lo = 1e9, hi = -1e9, n = 0, sum = 0;
      for (let k = 0; k < 24000; k++) {
        const x = (fract(k * 0.7548776662) * 2 - 1) * half * 0.98;
        const z = (fract(k * 0.5698402909) * 2 - 1) * half * 0.98;
        if (Math.hypot(x, z) > R) continue;
        const h = Q.height(x, z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        const gx = (Q.height(x + 1, z) - Q.height(x - 1, z)) / 2;
        const gz = (Q.height(x, z + 1) - Q.height(x, z - 1)) / 2;
        sum += Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; n++;
      }
      return { relief: hi - lo, slope: sum / n, n };
    };
    const g = measure(P, 60), a = measure(A, 60);
    assert(g.n > 400, `only ${g.n} samples landed inside the inner disc`);
    assert(g.slope < a.slope * 1.5,
      `geonosis' fighting floor averages ${g.slope.toFixed(2)}° against the arena's ${a.slope.toFixed(2)}° — `
      + 'it is not the open ground the mode needs');
    /* …and it HOLDS that out to 180 m, which the arena cannot: the arena's rim
     * is a 27 m wall at 60 m. That is the difference between a fighting floor
     * and a battlefield. */
    const wide = measure(P, 180), aWide = measure(A, 180);
    assert(wide.slope < aWide.slope,
      `at 180 m geonosis averages ${wide.slope.toFixed(2)}° and the arena ${aWide.slope.toFixed(2)}° — `
      + 'the open ground does not reach the range the mode fights at');
    /* And the level's own spawn ring has to be out where you can SEE them
     * coming, or "give an order before the contact" is not a thing you can do.
     * Everything else in the game spawns at 26-60 m; this is the one level where
     * that would make the mode impossible. */
    const [rmin, rmax] = LEVELS.geonosis.spawnRadius;
    assert(rmin >= 50, `geonosis spawns contacts at ${rmin} m — inside the range you could react at`);
    assert(rmax > 80, `geonosis' outer ring is ${rmax} m, which is not a sightline`);
    return `inner 60 m ${g.slope.toFixed(2)}° / ${g.relief.toFixed(2)} m (arena ${a.slope.toFixed(2)}°); `
      + `at 180 m ${wide.slope.toFixed(2)}° vs ${aWide.slope.toFixed(2)}°; ring ${rmin}-${rmax} m`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Both sides                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: both armies are playable and priced rung for rung', () => {
    /* "can either be a Sith leading droids or a Jedi leading clone troopers …
     * can also be played with friends, maybe even coop and also against each
     * other where they're a sith and you're a jedi and vice versa."
     *
     * A mirror match is only a match if the two ladders are the same ladder.
     * An asymmetry here would be a difficulty setting hiding inside a faction
     * choice — and it would be invisible, because nothing on screen prints a
     * threat number. */
    const rep = Cmd.ARMIES.republic, cis = Cmd.ARMIES.separatist;
    assert(rep && cis, 'there are not two armies');
    assert(rep.tiers.length === cis.tiers.length,
      `${rep.tiers.length} Republic rungs against ${cis.tiers.length} Separatist`);
    /**
     * PARITY IS ON THE LADDER, NOT ON THE RUNG — and the difference is the
     * finding this check produced on its first run.
     *
     * The first draft asserted `ta.threat === tb.threat` per rung and failed at
     * rung 1: a clone trooper is threat 2 and a B1 is threat 1. That is not a
     * bug in the ladder, it is the source material and it is the game's own
     * long-standing pricing — the Confederacy wins by numbers and the Republic
     * by quality, which is the whole distinction between the two armies. What
     * would have been a bug is either army getting a better EXCHANGE RATE, and
     * that is what the first draft actually caught: both ladders were priced by
     * hand and a clone was 1.5 threat per point against a B1's 1.0.
     *
     * So: the price is derived from the threat by one formula (`musterCost`),
     * the two ladders total the same threat and the same points, and no rung on
     * either side is better value than its opposite number. A hand-written price
     * beside the thing that decides what the price should be is the defect this
     * repository has now been bitten by nine times.
     */
    const rows = [];
    let ta = 0, tb = 0, ca = 0, cb = 0;
    for (let i = 0; i < rep.tiers.length; i++) {
      const r = rep.tiers[i], c = cis.tiers[i];
      const Ar = ARCHETYPES[r.type], Ac = ARCHETYPES[c.type];
      assert(Ar, `${r.type} is on the Republic ladder and is not an archetype`);
      assert(Ac, `${c.type} is on the Separatist ladder and is not an archetype`);
      assert(r.cost === Cmd.musterCost(r.type) && c.cost === Cmd.musterCost(c.type),
        `rung ${i + 1} carries a hand-written price beside the formula that decides it`);
      assert(r.at === c.at, `rung ${i + 1} unlocks in different areas for the two armies`);
      ta += Ar.threat; tb += Ac.threat; ca += r.cost; cb += c.cost;
      rows.push(`${r.type}(${Ar.threat}/${r.cost}) · ${c.type}(${Ac.threat}/${c.cost})`);
    }
    /**
     * TOTALS CLOSE, NOT IDENTICAL — and the loosening is a finding rather than
     * a concession.
     *
     * The first draft asserted `ta === tb` exactly, which held while both
     * ladders were infantry. It stopped holding the moment the armies got
     * MACHINES: an AT-TE is a six-legged 1500 hp gun platform at threat 17 and
     * an AAT is a 1050 hp hover tank at 13, and there is no honest way to make
     * those the same number. Requiring it would have forced one army's hardware
     * to be the other's with a repaint, which is the opposite of what a faction
     * choice is for.
     *
     * The property that actually protects a mirror match is the EXCHANGE RATE —
     * nobody may buy more fight per point than their opponent — and that is
     * asserted exactly, per rung, below. The totals are held to 12% as a
     * backstop against one ladder quietly growing an extra rung.
     */
    const skew = Math.abs(ta - tb) / Math.max(ta, tb);
    const cskew = Math.abs(ca - cb) / Math.max(ca, cb);
    assert(skew < 0.12,
      `the Republic ladder is worth ${ta} threat and the Confederacy's ${tb} — ${(skew * 100).toFixed(0)}% apart`);
    assert(cskew < 0.12,
      `the Republic ladder costs ${ca} points and the Confederacy's ${cb}`);
    // THE EXCHANGE RATE, per rung. 0.2 threat per point is the width of the
    // rounding in `musterCost`'s own `+1` per body at the light end.
    for (let i = 0; i < rep.tiers.length; i++) {
      const vr = ARCHETYPES[rep.tiers[i].type].threat / rep.tiers[i].cost;
      const vc = ARCHETYPES[cis.tiers[i].type].threat / cis.tiers[i].cost;
      assert(Math.abs(vr - vc) < 0.2,
        `rung ${i + 1}: ${rep.tiers[i].type} is ${vr.toFixed(2)} threat per point against `
        + `${cis.tiers[i].type}'s ${vc.toFixed(2)}`);
    }
    /* AND A LADDER THAT REACHES A MACHINE. The back half of a campaign is what
     * the muster points are for; a top rung that is still infantry means the
     * five areas are the same shopping list five times. */
    const top = rep.tiers[rep.tiers.length - 1];
    assert(ARCHETYPES[top.type].big, `the top of the Republic ladder is ${top.type}, which is not a machine`);
    assert(ARCHETYPES[cis.tiers[cis.tiers.length - 1].type].big,
      'the top of the Confederacy ladder is not a machine');
    /* …and it has to be AFFORDABLE by the end. A rung nobody can ever reach is
     * a rung that does not exist — measured against the whole campaign's
     * payout, since a machine is what you save for. */
    const purse = Cmd.AREAS.reduce((n, a) => n + a.muster, 0);
    assert(top.cost < purse * 0.6,
      `the top rung costs ${top.cost} against a whole campaign's ${purse} points`);
    // …and the ladder actually CLIMBS. A "tier ladder" whose rungs are all the
    // same weight is a shopping list.
    for (let i = 1; i < rep.tiers.length; i++) {
      assert(rep.tiers[i].cost >= rep.tiers[i - 1].cost,
        `rung ${i + 1} costs less than rung ${i}`);
    }
    /* THREE TIMES, and the number is the ladder's own shape rather than a
     * taste: rung 1 is threat 2 and rung 5 is threat 7 on the Republic side,
     * 1 and 7 on the Confederacy's. A "tier ladder" whose top rung is not
     * several times its bottom one is a shopping list with prices on it. */
    assert(ARCHETYPES[rep.tiers[rep.tiers.length - 1].type].threat
      >= ARCHETYPES[rep.tiers[0].type].threat * 3,
      'the top of the ladder is not meaningfully above the bottom of it');
    // The order chooses the army, and it must not be answerable twice.
    assert(Cmd.sideForOrder('jedi') === rep, 'a Jedi does not lead the Republic');
    assert(Cmd.sideForOrder('sith') === cis, 'a Sith does not lead the Confederacy');
    assert(Cmd.enemyOf(rep) === cis && Cmd.enemyOf(cis) === rep, 'the armies do not oppose each other');
    return `${rep.tiers.length} rungs a side: ` + rows.join(', ');
  });

  check('command: every body Command adds is reachable and distinct', () => {
    /* `roster.mjs` already asserts that nothing is unreachable. What it cannot
     * say is whether the seven new bodies are seven different fights, which is
     * the thing the note actually asks for ("probably make different tiers of
     * troops too"). Two units with the same engagement band and the same cadence
     * are one unit with two names. */
    const keys = Object.keys(Cmd.COMMAND_UNITS);
    assert(keys.length >= 6, `only ${keys.length} new bodies`);
    const pool = LEVELS.geonosis.pool;
    const seen = new Set();
    for (const k of keys) {
      assert(ARCHETYPES[k], `${k} is declared and never registered`);
      assert(pool.includes(k), `${k} is in no pool, so no player can meet it`);
      const A = ARCHETYPES[k];
      // The signature of a unit: where it wants to stand, and how often it
      // fires. Rounded, because two units 30 cm apart are the same unit.
      const sig = A.melee ? `melee${Math.round(A.damage / 5)}`
        : `${Math.round(A.preferred[0])}-${Math.round(A.preferred[1])}/${A.burst}`;
      assert(!seen.has(sig), `${k} fights identically to something already in the roster (${sig})`);
      seen.add(sig);
    }
    /* NOTE #31, BY NAME: "there should be jet troopers." A jet trooper that does
     * not leave the ground is a trooper.
     *
     * THIS ASSERTION USED TO READ `ARCHETYPES.jet.float > 0.8` — the archetype
     * TABLE — and it passed for the entire life of the feature while the jet
     * trooper's y position was NaN from its first frame, it never fired a shot,
     * and the liveness watchdog deleted it from every wave it spawned into.
     * That is HANDOFF §2.4 in its purest form: the check restated the datum
     * instead of measuring the game, so it could only ever confirm that
     * somebody had typed a number into a table.
     *
     * The datum is still worth asserting — it is what makes the body hover —
     * but it is now the SETUP, and the body itself is the measurement. See the
     * flight check below, which spawns one and steps it.
     */
    assert(ARCHETYPES.jet && ARCHETYPES.jet.float > 0.8,
      'the jet trooper declares no float — note #31 asks for a jet trooper');
    return `${keys.length} bodies, ${seen.size} distinct engagement signatures`;
  });

  /**
   * …AND THE BODY ACTUALLY LEAVES THE GROUND, which is the half the table
   * cannot tell you.
   *
   * Every number here was a real symptom: NaN y from frame 0, because
   * `hoverPhase` was initialised inside a branch a rigged humanoid never
   * takes; zero shots in 45 s, because `distToTarget` is a 3-D length and NaN
   * fails every range comparison in `_rangedBrain`; and retirement by the
   * watchdog, because `positionIsValid` rejects a non-finite y.
   *
   * So this asserts the three things that were each individually false: the
   * position is finite, it is genuinely off the ground, and the body still
   * shoots. Any one of them regressing brings the whole archetype down again.
   */
  check('command: the jet trooper actually flies, and shoots while it does', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const THREE = await import('three');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves' } });
    const p = world.player.position;
    const e = world.spawnEnemy('jet', new THREE.Vector3(p.x + 14, world.terrain.height(p.x + 14, p.z), p.z));
    assert(e, 'no jet trooper spawned');
    let minClear = Infinity, shots = 0;
    /**
     * COUNT THE LIVE BOLTS, and this took two wrong answers to get right —
     * both of which reported ZERO and both of which would have shipped a check
     * whose own title was a claim it had not tested.
     *
     *   1. `.live` / `.count` — neither field exists, so the `?? 0` fallback
     *      returned 0 every frame.
     *   2. `.bolts.length` — `BoltPool` PREALLOCATES (Bolts.js:36-40, `max` is
     *      460), so the array's length is a constant and can never move.
     *
     * A bolt is in flight when `active` is true (Bolts.js:108, cleared at 175).
     * That is the only honest reading, and the fault in both earlier attempts
     * is the one this whole check exists to punish: a number that was never
     * measured, sitting next to an assertion that could not fail.
     */
    /**
     * …AND A THIRD WRONG ANSWER, WHICH IS THE ONE THAT ACTUALLY SHIPPED.
     *
     * The count above was the POPULATION of live bolts, and `shots` was the
     * number of frames that population ROSE. That is a delta on a total, and a
     * total has other contributors: this world is a `waves` Geonosis with a
     * director in it, so on any frame where the jet fires one and two of
     * somebody else's expire, the total falls and the shot is not counted. With
     * an empty sky it works; with traffic it undercounts, and at zero it
     * reports that the jet never fired at all.
     *
     * That is exactly the fault the note above this one exists to punish, one
     * layer further in — a number measured off the wrong population, sitting
     * next to an assertion whose failure message then blamed something else
     * entirely. It went red in a full verify and green alone, and the message
     * it printed named a NaN position that the per-frame assertion four lines
     * up had already ruled out on every one of the 240 frames.
     *
     * A bolt carries its `owner` (Bolts.js:120), so the honest count is the
     * jet's own bolts crossing from inactive to active. Pool reuse is handled
     * by comparing the SET frame to frame rather than a number: a slot that was
     * this body's bolt last frame and is this body's bolt again now is the same
     * shot until it goes out.
     */
    let flying = new Set();
    for (let i = 0; i < 240; i++) {
      world.update(1 / 60, idleInput());
      assert(Number.isFinite(e.position.y),
        `the jet trooper's y went non-finite on frame ${i} — hoverPhase is uninitialised again`);
      const clear = e.position.y - world.terrain.height(e.position.x, e.position.z);
      if (i > 30) minClear = Math.min(minClear, clear);
      const now = new Set();
      for (const b of world.bolts?.bolts ?? []) if (b.active && b.owner === e) now.add(b);
      for (const b of now) if (!flying.has(b)) shots++;
      flying = now;
    }
    assert(minClear > 0.8,
      `the jet trooper flew at ${minClear.toFixed(2)} m of clearance — it is walking`);
    assert(!e.dead && !e.retired,
      'the jet trooper was retired mid-flight — the watchdog is rejecting its position');
    /* The third symptom, and the one the table could never see: NaN made every
     * range test in `_rangedBrain` false, so the body flew and never fired. */
    /* The third symptom of the NaN, and the one the table could never see: it
     * made every range test in `_rangedBrain` false, so the body flew and never
     * fired. Counted per-owner now, so a quiet sky and a busy one give the same
     * answer — see the note over the loop. */
    assert(shots > 0,
      `the jet trooper fired ${shots} of its own bolts in 4 s at `
      + `${e.position.distanceTo(world.player.position).toFixed(1)} m — it is flying and not `
      + 'shooting, which is what a NaN position looks like from _rangedBrain');
    world.unload();
    return `clearance ${minClear.toFixed(2)} m over 4 s, ${shots} shots of its own, y finite throughout`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Names, permadeath, experience, rank                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: every trooper has a name of its own, and it never comes back', () => {
    /* "every ally has a unique name you can see which makes the gameplay more
     * interesting because you can see who lived or who died … your troops when
     * dead will permanently die unless they are replaced." */
    const { d } = dirFor();
    assert(d.roster.strength === Cmd.OPENING_STRENGTH,
      `the campaign opens with ${d.roster.strength} bodies, not ${Cmd.OPENING_STRENGTH}`);
    // Fill the roster right up, so uniqueness is tested at the size it has to
    // hold at rather than at ten.
    d.roster.points = 999;
    for (let i = 0; i < 40 && d.roster.strength < Cmd.MAX_STRENGTH; i++) d.recruit(d.army.tiers[0].type);
    const names = d.roster.all.map((t) => t.name);
    assert(new Set(names).size === names.length,
      `${names.length - new Set(names).size} of ${names.length} designations are duplicates`);

    // PERMADEATH. Kill one, and it must not be replaceable by anything except a
    // purchase — and the record must survive so the casualty list can show it.
    const victim = d.roster.living[3];
    const was = d.roster.strength;
    d.roster.fall(victim, 1);
    assert(d.roster.strength === was - 1, 'a death did not reduce the strength');
    assert(!victim.alive && victim.diedIn === 1, 'the record does not remember dying');
    assert(d.roster.all.includes(victim), 'a fallen trooper is deleted rather than kept — there is no casualty list');
    assert(d.roster.fallen.includes(victim), 'the dead do not appear among the fallen');
    // Idempotent: a body can be reported dead more than once (the killer's path
    // and the corpse budget's), and a roster that counted both would go negative.
    assert(d.roster.fall(victim, 2) === false, 'a second death report counted again');
    assert(d.roster.strength === was - 1, 'a doubled death report moved the strength');
    // …and a REPLACEMENT is a new name, not the old one back.
    d.roster.points = 99;
    const fresh = d.recruit(d.army.tiers[0].type);
    assert(fresh && fresh !== victim && fresh.name !== victim.name,
      'a replacement reused a dead trooper\'s identity');
    return `${names.length} unique designations, a death is permanent and idempotent`;
  });

  check('command: a trooper that survives is visibly promoted, in three ways at once', () => {
    /* "maybe one particular one lasts longer than the others and you protect him
     * … the specific troopers that survive get more experience as they live and
     * get stronger themselves too so for instance the one npc that's somehow
     * survived from the beginning is now quite strong as they've been promoted."
     *
     * THREE THINGS OR NONE. A rank that only exists in a list is the thing this
     * codebase keeps deleting: a title you can read, a COLOUR you can read at
     * range, and numbers that actually moved. */
    const R = Cmd.RANKS;
    assert(R.length >= 4, `only ${R.length} ranks`);
    for (let i = 1; i < R.length; i++) {
      assert(R[i].xp > R[i - 1].xp, `rank ${i} is not above rank ${i - 1} in experience`);
      assert(R[i].hp > R[i - 1].hp && R[i].dmg > R[i - 1].dmg,
        `${R[i].title} is not stronger than ${R[i - 1].title} — the promotion is a title only`);
      assert(R[i].color != null, `${R[i].title} has no colour, so it cannot be read on the field`);
      assert(R[i].title !== R[i - 1].title, 'two ranks share a title');
    }
    const cols = R.slice(1).map((r) => r.color);
    assert(new Set(cols).size === cols.length, 'two ranks wear the same colour');
    assert(R[0].color == null, 'the bottom rung is painted, so a plain trooper is not plain');
    // The ladder is climbable in ONE campaign and only just — the top rung is
    // for the body that lived through all of it.
    const perArea = 2 + 4;                       // survive it, plus a share of the kills
    const total = Cmd.AREAS.reduce((n, a) => n + a.waves, 0) + Cmd.AREAS.length * perArea;
    assert(R[R.length - 1].xp <= total,
      `the top rank needs ${R[R.length - 1].xp} xp and a whole campaign is worth about ${total}`);
    assert(R[R.length - 1].xp > total * 0.4,
      'the top rank arrives too early to be the one who survived everything');

    // And the award path itself: it promotes exactly once per gate crossed.
    const t = new Cmd.Trooper(Cmd.ARMIES.republic, 'trooper', 'CT-0001');
    assert(t.rank === 0 && t.award(R[1].xp - 1) === null, 'a trooper promoted before the gate');
    const p = t.award(1);
    assert(p === R[1], 'crossing the gate did not report a promotion');
    assert(t.award(0) === null, 'awarding nothing promoted somebody');
    // A jump straight past a gate still promotes, and to the RIGHT rank.
    const t2 = new Cmd.Trooper(Cmd.ARMIES.republic, 'trooper', 'CT-0002');
    assert(t2.award(R[3].xp) === R[3], 'a big award landed on the wrong rung');
    return `${R.length} ranks, ${new Set(cols).size} distinct colours, top at ${R[R.length - 1].xp} xp of ~${total}`;
  });

  check('command: both armies learn names, and no two bodies answer to the same one', () => {
    /**
     * "EVERY ALLY HAS A UNIQUE NAME YOU CAN SEE which makes the gameplay more
     * interesting because you can see who lived or who died."
     *
     * `award()` gated the whole nickname mechanic on `this.army === 'republic'`,
     * so a Sith's droids could not earn a name at any rank, ever. That is half
     * of note #21's identity feature missing from one of the two sides the same
     * note names — and the file's stated reason ("droids get a COMMAND
     * DESIGNATION instead") described a branch that did not exist: there was no
     * second table, no designation change, nothing.
     *
     * And the clone side was not unique either. `NICKNAMES[floor(rng() * n)]`
     * with no check against the roll puts two Ladders in the one list the player
     * is meant to read.
     *
     * Asserted by promoting a FULL roster on each side through the shipped
     * `award`, which is the only thing that hands one out.
     */
    const rows = [];
    for (const army of Object.values(Cmd.ARMIES)) {
      const { d } = dirFor({ army });
      d.roster.points = 9999;
      for (let i = 0; i < 40 && d.roster.strength < Cmd.MAX_STRENGTH; i++) d.recruit(army.tiers[0].type);
      const roll = d.roster.living.slice();
      assert(roll.length >= 20, `${army.name} only mustered ${roll.length}`);
      // The gate is the SECOND rung and nothing below it.
      const first = roll[0];
      first.award(Cmd.RANKS[1].xp);
      assert(first.rank === 1 && !first.nickname,
        `${army.name}: a name was handed out at rung ${first.rank}, below the gate`);
      for (const t of roll) t.award(Cmd.RANKS[2].xp);
      const named = roll.filter((t) => t.nickname);
      assert(named.length === roll.length,
        `${army.name}: ${named.length} of ${roll.length} promoted bodies earned a name`);
      const set = new Set(named.map((t) => t.nickname));
      assert(set.size === named.length,
        `${army.name}: ${named.length - set.size} of ${named.length} names are duplicates — `
        + 'the one list the player is meant to read has two bodies answering to the same word');
      // …and it is on the label, which is the only place a player ever sees it.
      assert(roll[0].name.includes(roll[0].nickname), 'the earned name is not in the printed name');
      // …and it is never lost.
      roll[0].award(Cmd.RANKS[4].xp);
      assert(roll[0].nickname === named[0].nickname, 'a further promotion changed the name');
      rows.push(`${army.id} ${set.size}/${roll.length}`);
    }
    /* THE TWO TABLES ARE TWO TABLES. One list shared between the armies would
     * put "Hardcase" on a battle droid, which is the other half of the same
     * defect. */
    const { d: rep } = dirFor();
    const { d: cis } = dirFor({ army: Cmd.ARMIES.separatist });
    const nameOne = (d) => { const t = d.roster.living[0]; t.award(Cmd.RANKS[2].xp); return t.nickname; };
    const a = new Set(), b = new Set();
    for (let i = 0; i < 12; i++) { a.add(nameOne(rep)); rep.roster.living.shift(); }
    for (let i = 0; i < 12; i++) { b.add(nameOne(cis)); cis.roster.living.shift(); }
    assert([...a].every((n) => !b.has(n)),
      'a clone and a battle droid drew from the same list of names');
    return `${rows.join(', ')} unique names earned at rung 2; the two armies' tables do not overlap`;
  });

  check('command: the roster crosses an area, and the muster is what refills it', () => {
    /* "between rounds or areas on the map you get stronger and upgrade your
     * troops or bring in more troops." The roster is the one object that
     * outlives an area — the bodies are rebuilt at every boundary, so a name
     * that lived on the body would die at every boundary. */
    const { d } = dirFor();
    const opening = d.roster.all.slice();
    const areaOne = d.area;
    // Lose four, then clear the area.
    for (let i = 0; i < 4; i++) d.roster.fall(d.roster.living[0], 1);
    d.areaWaves = areaOne.waves - 1;
    d.wave = areaOne.waves;
    const paid = d.payWave(areaOne.waves);
    assert(paid, 'clearing the last wave of an area did not pay');
    assert(d.areaIndex === 1, 'the area did not advance');
    /* `>=`, not `===`: the muster ADDS records, and the property is that
     * nothing is ever LOST. A roster that only grows is exactly what a casualty
     * list is. */
    assert(d.roster.all.length >= opening.length,
      'the roster lost records across an area — the casualty list does not survive');
    for (const t of opening) assert(d.roster.all.includes(t), `${t.name} is not in the roster after an area`);
    /* The OPENING survivors, not everybody: the muster has already run by this
     * point and its recruits have crossed nothing. Crediting them would be the
     * check asserting that a body bought after the area fought through it. */
    const survivors = opening.filter((t) => t.alive);
    assert(survivors.length > 0, 'nobody survived the first area at all');
    assert(survivors.every((t) => t.areas === 1), 'survivors were not credited with the area');
    assert(survivors.every((t) => t.xp > 0), 'a body that lived through an area earned nothing');
    // The muster ran (no screen is wired in this fixture, so the director
    // musters for itself rather than stopping the campaign on a UI that does
    // not exist) and it REPLACED the losses.
    assert(d.roster.strength >= Cmd.OPENING_STRENGTH,
      `the muster left the line at ${d.roster.strength}`);
    // …and it PAID for them. A mode that refills the line for free has removed
    // the thing note #21 asks it to add.
    assert(d.roster.points < areaOne.muster + 1,
      `the muster spent nothing: ${d.roster.points} points still held`);
    // The offer is gated on the area, so the campaign teaches its own roster.
    const early = new Cmd.CommandDirector(cmdWorld(), { pool: LEVELS.geonosis.pool });
    const sold = early.musterOffer().units.map((u) => u.type);
    const late = d.army.tiers.filter((t) => t.at > 1).map((t) => t.type);
    for (const t of late) assert(!sold.includes(t), `${t} is on sale in area 1`);
    assert(sold.length > 0, 'nothing at all is on sale in area 1');
    return `${d.roster.all.length} records across an area (${d.roster.fallen.length} fallen), `
      + `${sold.length} of ${d.army.tiers.length} rungs on sale at the start`;
  });

  check('command: the advance ends, once, and the run is recorded as won', async () => {
    /**
     * THE CAMPAIGN HAD NO END, AND IT IS THE DEFECT THIS SUITE MOST OBVIOUSLY
     * SHOULD HAVE HAD.
     *
     * `_areaClear` on the last area notified, cleared `mustering` and returned
     * WITHOUT resetting `areaWaves`. `area` clamps to the last entry, so the
     * counter stayed at or above `area.waves` forever and the branch re-entered
     * on EVERY subsequent wave clear: another announcement, another +2 xp to
     * every body, another payout of the last area's reinforcement points —
     * uncapped — and another entry on a log nothing trims.
     *
     * Driven to the real ending: the last area, a real wave through
     * `world.update`, a real clear. Then the run is kept going and the same
     * ledger is asked again, which is the half a one-shot assertion would miss.
     */
    const { world, d, input } = await commandWorld({ formation: 'front', trim: 2 });
    // The last area, one wave short of holding it. Everything from here is the
    // shipped path: payWave → _areaClear → lastArea → _endCampaign.
    d.areaIndex = Cmd.AREAS.length - 1;
    d.areaWaves = d.area.waves - 1;
    assert(d.lastArea, 'the fixture did not reach the last area');
    const overs = [];
    world.onGameOver = (s) => overs.push(s);

    const t = drive(world, 180, input, () => overs.length > 0);
    assert(overs.length === 1,
      `${overs.length} game-over events from one finished campaign after ${t.toFixed(0)}s`);
    const s = overs[0];
    assert(s.won === true,
      'the advance ended and the summary does not say it was WON — `won` is the field '
      + 'Progress.recordRun reads for `wins` and `crowned`, and nothing in src/ used to set it');
    assert(d.done, 'the director does not know the campaign is over');
    assert(world.over, 'the world is still running waves at a finished campaign');
    assert(d.roster.all.every((x) => !x.body),
      'the army is still standing on the field after the advance ended — recall did not run');

    // AND IT DOES NOT HAPPEN AGAIN. Keep the clock running, then ask the ledger
    // for another wave by hand — which is exactly what `payWave` used to accept.
    const points = d.roster.points, logged = d.log.length, xp = d.roster.all.reduce((n, x) => n + x.xp, 0);
    drive(world, 20, input);
    d.payWave(d.wave + 1);
    d.payWave(d.wave + 2);
    assert(overs.length === 1, `the campaign ended ${overs.length} times`);
    assert(d.roster.points === points,
      `the muster paid out again after the advance was over: ${points} → ${d.roster.points}`);
    assert(d.log.length === logged, `the campaign log grew by ${d.log.length - logged} after it ended`);
    assert(d.roster.all.reduce((n, x) => n + x.xp, 0) === xp, 'the roster earned experience after the end');
    const won = { ...s };
    world.unload();
    return `ended once at ${t.toFixed(0)}s in area ${Cmd.AREAS.length}, won=${won.won}, `
      + `${d.roster.strength} of ${d.roster.all.length} walked off; two further payWave calls paid nothing`;
  });

  check('command: a victory reports the same stats a defeat does', async () => {
    /**
     * A PIN ON A TWIN THIS FILE'S OWNER COULD NOT DELETE — AND THE TWIN IS GONE.
     *
     * `World._checkWipe` assembled the six numbers a finished session is
     * described by, inline, inside its `onGameOver` call; `_endCampaign`
     * assembled the same six again for a session that ended by being WON. Two
     * assemblies of one object, the shape this repository has been bitten by
     * nine times (HANDOFF §2.3). It could not be deleted from here, so this
     * drove a real party wipe and a real campaign victory and required the two
     * summaries to carry the identical set of keys.
     *
     * `World.runStats()` landed and all four endings call it, so the key-set
     * clause is now held by construction rather than by luck. It stays: it is
     * what fails the day somebody assembles a fifth ending by hand.
     *
     * WHAT DID CHANGE IS THE TYPE CLAUSE, and the reason is the fix rather than
     * a defect. `runStats` carries two fields more than the six — `taken` and
     * `fallen`, the two main.js's victory card reads — and a mode with no army
     * has no answer for either: a Trial of Waves takes no ground and loses no
     * troops. Both come back `null` there, and `gameOver` DROPS a row it has no
     * number for rather than printing the invented "Areas taken 5" this whole
     * line of work started from. A flat `typeof` equality reports that as
     * drift: `object` against `number`.
     *
     * So the pairing is stated instead, and it is stricter than the equality
     * was. The wipe below is driven in `waves`, which builds no CommandDirector
     * — asserted, not assumed — so a field that is null on that side is
     * required to be a NUMBER on the campaign side. A field that went null on
     * both would mean the mode WITH an army cannot count its own casualties,
     * and that is exactly the hole the null is allowed to describe.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    /* A REAL LEVEL, NAMED. `World.loadLevel` substitutes `LEVEL_ORDER[0]` for a
     * key it does not know — right for a player with a stale profile, a trap in
     * a check (HANDOFF §2.6) — and `bootWorld`'s own default is `arena`, which
     * the roster cull deleted. `roster.mjs`'s sixth form is what catches it. */
    const { world } = await bootWorld({ level: 'colosseum', settings: { mode: 'waves' } });
    let wipe = null;
    world.onGameOver = (s) => { wipe = s; };
    world.player.die(null);
    for (let i = 0; i < 8 && !wipe; i++) world.update(STEP, idleInput());
    assert(wipe, 'killing the only player did not produce a game-over summary');
    const armyless = !world.command;
    world.unload();

    const { world: w2, d, input } = await commandWorld({ trim: 1 });
    d.areaIndex = Cmd.AREAS.length - 1;
    d.areaWaves = d.area.waves - 1;
    let win = null;
    w2.onGameOver = (s) => { win = s; };
    drive(w2, 180, input, () => !!win);
    assert(win, 'the campaign did not finish');
    const a = Object.keys(wipe).sort(), b = Object.keys(win).filter((k) => k !== 'won').sort();
    assert(a.join() === b.join(),
      `a defeat reports {${a.join(', ')}} and a victory {${b.join(', ')}} — the two assemblies have drifted`);
    /* The premise of the null branch below, measured rather than believed: the
     * wipe is driven in a mode that leads no army, and the victory in the mode
     * whose whole subject is one. */
    assert(armyless, 'the wipe was driven in a mode that DOES lead an army — the branch below is meaningless');
    assert(w2.command, 'the campaign victory was driven without a CommandDirector');
    /**
     * …AND THE NULL RULE IS ABOUT COUNTS, WHICH IS NARROWER THAN "FIELDS".
     *
     * The rule below says a field that is null in a mode with no army owes a
     * NUMBER in the mode that leads one, and the defect it was written against
     * is exactly that shape: `taken` and `fallen` are counts, and a campaign
     * that cannot count its own casualties is the hole the null describes.
     *
     * `ended` is not a count. It is the reason a run stopped, and null is its
     * correct value in both arms here because neither of them stopped for a
     * reason worth a different card — one is a party wipe and the other is a
     * victory. Held to the count rule it reads as drift, and "the mode with an
     * army owes a number for why it ended" is not a sentence anybody means.
     *
     * The discriminator is DERIVED rather than a name: a field the ending card
     * prints as a ROW is a count, and a field it reads outside the rows is a
     * discriminator that picks which card to print. `rows` is lifted out of
     * main.js's own source, exactly as `skirmish.mjs` lifts the card's whole
     * field list from it — so this file cannot disagree with the card about
     * what a row is.
     */
    const { readFile } = await import('node:fs/promises');
    const mainSrc = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const rowsSrc = (() => {
      const j = mainSrc.indexOf('  const rows = ');
      const k = mainSrc.indexOf('  const card = ', j);
      assert(j > 0 && k > j, 'main.js no longer builds the ending card as `const rows` — this lift is describing a file that is gone');
      /* CODE ONLY: the block comment over the rows quotes two field names it is
       * an account of, and a scan that counts prose finds rows the card does
       * not print — an instrument manufacturing its own defect (§2.4). */
      return mainSrc.slice(j, k).replace(/\/\*[\s\S]*?\*\//g, ' ');
    })();
    const printed = new Set([...rowsSrc.matchAll(/\bstats\.(\w+)/g)].map((m) => m[1]));
    assert(printed.size >= 5,
      `only ${printed.size} fields lifted out of the card's rows — the lift is wrong`);

    const absent = [];
    for (const k of a) {
      if (wipe[k] === null) {
        if (!printed.has(k)) {
          /**
           * Not a row, so nothing below applies. It still may not DIFFER in
           * kind between the two endings — that is the drift this check is
           * for — and both being null is the agreement it wants.
           *
           * ── EXCEPT WHERE IT IS THE NAMES BEHIND A ROW THAT IS ITSELF NULL ──
           *
           * `roll` is §4.9's after-action list and `report` is the same list
           * counted, and neither is a row: the card prints "Troops lost" as a
           * count and hands the NAMES and the CENSUS to `showDeath` separately.
           * So both are null in exactly the runs where `fallen` is null — a
           * mode with no company — and present in exactly the runs where
           * `fallen` is a number, including on an army that lost nobody, which
           * is a different and true statement.
           *
           * That is a stronger claim than "the two endings agree", so it is
           * asserted as the PAIRING rather than excused: whenever a non-row
           * field goes null with `fallen`, it must go non-null with `fallen`
           * too. A `roll` that stayed null on a run that lost six men would
           * fail this, which is the defect worth catching — the count saying
           * six and the list saying nothing.
           *
           * WHAT IT MAY COME BACK AS is a projection of the log and not a
           * scalar: a list of the fallen, or a record with those lists inside
           * it. A number here would be a third count of the dead beside
           * `fallen` and the roll's own length, which is how three answers to
           * one question get into one card.
           */
          if (wipe.fallen === null && win.fallen !== null && win[k] !== null) {
            assert(Array.isArray(win[k]) || typeof win[k] === 'object',
              `${k} follows \`fallen\` and came back as ${JSON.stringify(win[k])} — `
              + 'a field that pairs with the roll is the log projected, not a number');
            continue;
          }
          assert(win[k] === null,
            `${k} is not a row on the card, is null after a wipe and ${JSON.stringify(win[k])} `
            + 'after a victory — two endings disagree about a field neither prints');
          continue;
        }
        absent.push(k);
        assert(typeof win[k] === 'number',
          `${k} is null in a mode with no army and ${JSON.stringify(win[k])} in the mode that leads one — `
          + 'a null means "this run has no such thing", so the run that HAS one owes a number');
        continue;
      }
      assert(win[k] !== null,
        `${k} is ${JSON.stringify(wipe[k])} in a mode with no army and null in the campaign — `
        + 'the mode whose subject is named people dying cannot be the one that has no answer');
      assert(typeof win[k] === typeof wipe[k],
        `the victory's ${k} is a ${typeof win[k]} where a defeat's is a ${typeof wipe[k]}`);
    }
    w2.unload();
    return `${a.length} shared fields (${a.join(', ')}) plus won on the victory; `
      + `${absent.length} of them (${absent.join(', ') || 'none'}) are null with no army and a number with one`;
  });

  check('command: a trooper the watchdog withdraws is a casualty, not a free respawn', async () => {
    /**
     * PERMADEATH FIRED ZERO TIMES IN 66 MINUTES OF DRIVEN PLAY, and this is one
     * of the two reasons.
     *
     * `Waves._retire` set `e.dead = true` and told nobody. `deploy()` skips a
     * record whose body is alive and builds a new one for every record whose
     * body is dead or missing — which is exactly the state a retirement leaves
     * behind — so a retired trooper was silently rebuilt at the next area with
     * its name, rank and experience intact. The watchdog was a free respawn.
     *
     * Driven on real bodies in a real world, through the shipped `_retire`.
     */
    const { world, d, input } = await commandWorld({ trim: 1 });
    drive(world, 2, input);
    const victim = d.roster.living[0];
    const body = victim.body;
    assert(body && !body.dead, 'the fixture trooper never got a body');
    const was = d.roster.strength;

    d._retire(body, { best: Infinity, hp: body.hp, t: 0, n: 9 }, 'a check');
    assert(body.dead, 'the retirement did not take the body off the field');
    assert(!victim.alive, 'a withdrawn trooper is still on the roll — it was not a casualty');
    assert(victim.diedIn === d.areaNumber, 'the casualty does not record where it fell');
    assert(d.roster.strength === was - 1, `the strength did not fall: ${was} → ${d.roster.strength}`);
    assert(d.roster.fallen.includes(victim), 'the withdrawn trooper is not on the casualty list');

    // …AND IT DOES NOT COME BACK. This is the half that made the bug invisible.
    const before = world.enemies.filter((e) => e.trooper && !e.dead).length;
    d.deploy();
    const after = world.enemies.filter((e) => e.trooper && !e.dead).length;
    assert(after <= before, `deploy resurrected ${after - before} body/bodies for a dead record`);
    assert(!victim.body, 'the dead record was handed a new body');
    world.unload();
    return `${was} → ${d.roster.strength} standing, the name is on the casualty list and deploy left it there`;
  });

  check('command: the watchdog does not dismantle the formation it was asked to protect', async () => {
    /**
     * "TAKE COVER" WAS DESTROYED BY THE LIVENESS WATCHDOG.
     *
     * `_watchdog` measures each body's distance to the nearest PLAYER, and a
     * squad ordered to go to ground stays where it was told while the commander
     * walks away from it. Driven before the fix, on this same scenario: ten
     * troopers planted and a commander walking a wide circle produced 25
     * interventions on the player's own line in 90 s — 20 rescues that teleport
     * a body to the level's spawn ring and 5 retirements — with the mean body 76
     * m off its ordered mark and seven of ten names off the roll.
     *
     * The rule that fixes it is the wave-end count's own arithmetic, called
     * rather than restated: a body that cannot hold a wave open is never the
     * reason it has not ended, and one of your own troops never can.
     *
     * The horde's own rescues are asserted to still be POSSIBLE rather than
     * required — a driven wave that happens to place every body somewhere
     * reachable is a good wave, not a broken watchdog.
     */
    /* THE STREAMS ARE NAMED because the roster assertion below is about
     * ATTRITION, and neither Waves' nor World's is put back between suites —
     * see the note on `commandWorld` for what that was costing. */
    const { world, d, input } = await commandWorld({ formation: 'cover', waveSeed: 20260830 });
    const mine = new Set(d.army.tiers.map((t) => t.type));
    // A commander who keeps walking: full stick with a slow turn, which is a
    // ~80 m circle at 4.6 m/s and takes the line well outside anything the
    // watchdog's distance-to-a-player clock would call "arrived".
    input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
    /**
     * …AND HE HAS TO SURVIVE THE WALK, or the back two thirds of this drive
     * prove nothing at all.
     *
     * `_watchdog` runs inside `CommandDirector.update`, and `World.update`
     * gates the director on `!this.over`. So the frame the commander dies is
     * the frame the watchdog stops looking — and `onMine.length === 0`, the
     * assertion this whole check is named after, becomes true because nothing
     * is running rather than because nothing intervened. Measured on this exact
     * scenario, one seed, 90 s:
     *
     *     commander mortal      run over at s52.9, 21 rescues, 2 names lost
     *     commander held        no end, 56 rescues on the horde, 0 names lost
     *
     * Fifty-six against twenty-one is the size of the hole: better than half of
     * the watchdog's work in this window happened after the point the mortal
     * run had stopped watching, and a check cannot assert the watchdog left
     * your line alone over ground it never covered.
     *
     * Holding the commander is also what takes the ROSTER assertion below off
     * the attrition question. Ten names went off the roll in one engagement
     * when this failed; with the commander alive the same drive loses none, and
     * "how much of a ten-man roster an engagement should cost" is a design call
     * nobody has made — it is in NEXT.md as a question, not in a constant here.
     */
    drive(world, 90, input, () => {
      world.player.hp = world.player.maxHp;
      world.player.camera.yaw += 0.055 * STEP;
      return false;
    });

    const log = d.rescues || [];
    const onMine = log.filter((r) => mine.has(r.type));
    let away = 0;
    for (const t of d.roster.living) {
      const e = t.body;
      if (!e || e.dead) continue;
      away = Math.max(away, Math.hypot(e.position.x - world.player.position.x,
        e.position.z - world.player.position.z));
    }
    assert(onMine.length === 0,
      `${onMine.length} watchdog interventions on your own line (${onMine.map((r) => r.what).join(', ')}) — `
      + 'a body standing where it was ORDERED to stand is being rescued from its own firing position');
    /**
     * THE PREMISE, TESTED DIRECTLY — and it used to be tested by proxy.
     *
     * `onMine.length === 0` is vacuously true if the watchdog was not running,
     * and the note above says exactly when that happens: `_watchdog` runs
     * inside `CommandDirector.update`, `World.update` gates the director on
     * `!this.over`, so the frame the commander dies is the frame it stops
     * looking. Something has to prove it looked.
     *
     * What stood here was a bound on ATTRITION — fewer than five of ten names
     * off the roll — and attrition is not this check's subject. The note that
     * introduced it says so itself: "how much of a ten-man roster an engagement
     * should cost is a design call nobody has made — it is in NEXT.md as a
     * question, not in a constant here." It was a stand-in for "the fixture
     * survived its own window", and it was a BAD one, because the quantity it
     * measures is chaotic and inherits a phase no runner puts back: the same
     * code read 0 names lost alone, 5 after `colosseum` and `command-pvp`, 6 on
     * a re-run of that, and 7 inside the full suite. It failed on a change to
     * the levy that can only ever make the enemy FIRE LESS, which is how it was
     * caught being a tripwire on unrelated work rather than a gate on this one.
     *
     * So the premise is asserted as the premise. The run must still be going
     * (or the director stopped and the count above means nothing), the line
     * must still exist to have been left alone, and the watchdog must have done
     * SOME work — its interventions on the horde are the proof it was awake for
     * the same window in which it did none on your men. None of the three
     * depends on which wave turned up.
     */
    assert(!world.over,
      'the run ended inside the 90 s window, so the director stopped and "no interventions on '
      + 'your line" is true because nothing was looking');
    assert(d.roster.strength > 0,
      'the whole line is dead, so there was nothing left for the watchdog to dismantle');
    assert(log.length > 0,
      'the watchdog logged no interventions anywhere in 90 s — it was not running, and "none on '
      + 'your own line" says nothing about a system that never ran');
    assert(away > 25,
      `the fixture never actually left its line behind — the furthest trooper was ${away.toFixed(0)} m away`);
    world.unload();
    return `commander walked away to ${away.toFixed(0)} m over 90s: 0 interventions on ${d.roster.strength} `
      + `troops holding cover, ${log.length} on the horde`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Formations                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: a rung goes on sale in the area its own ladder names', () => {
    /**
     * THE NINTH HAND-MAINTAINED TABLE BESIDE ITS GENERATED TWIN (HANDOFF §2.3),
     * and this one was an off-by-one nobody could see.
     *
     * `rung('arc', 3)` reads as "an ARC can be bought from area three". The
     * muster compared that 3 against a SECOND hand-written column,
     * `AREAS[i].tier`, which ran 1, 2, 2, 4, 4 — so `at: 3` was not satisfied by
     * area 3 (tier 2), it was satisfied by area 4. Every rung-4 and rung-5 body
     * on both ladders — the ARC, the Clone Commander, the BX and the MagnaGuard
     * — arrived one whole area later than the ladder said, in a five-area
     * campaign. Nothing on screen prints a tier, so it read as "the good units
     * never turn up".
     *
     * The second column is deleted. This asserts that it stays deleted and that
     * the offer and the purchase agree with the ladder at every area.
     */
    assert(Cmd.AREAS.every((a) => a.tier === undefined),
      'AREAS carries a `tier` column again, beside the `at` that decides the same thing');
    const rows = [];
    for (let i = 0; i < Cmd.AREAS.length; i++) {
      const { d } = dirFor();
      d.areaIndex = i;
      d.roster.points = 9999;
      const on = new Set(d.musterOffer().units.map((u) => u.type));
      for (const rung of d.army.tiers) {
        const should = rung.at <= i + 1;
        assert(on.has(rung.type) === should,
          `area ${i + 1}: ${rung.type} declares at:${rung.at} and is ${on.has(rung.type) ? '' : 'not '}on sale`);
        // …and the SALE is the same rule as the offer, or the screen lies.
        const bought = d.recruit(rung.type);
        assert(!!bought === should,
          `area ${i + 1}: ${rung.type} is ${should ? 'offered and refused' : 'not offered and sold'}`
          + (d.refused ? ` (${d.refused})` : ''));
      }
      rows.push(`${i + 1}:${on.size}`);
    }
    /* THE FOUR THAT WERE LOST, BY NAME. Both armies' rung 4 and rung 5. */
    const { d } = dirFor();
    d.areaIndex = 2;                                   // area 3
    d.roster.points = 9999;
    const three = new Set(d.musterOffer().units.map((u) => u.type));
    for (const t of ['arc', 'officer']) {
      assert(three.has(t), `${t} declares at:3 and is not on sale in area 3`);
    }
    const { d: cis } = dirFor({ army: Cmd.ARMIES.separatist });
    cis.areaIndex = 2;
    cis.roster.points = 9999;
    const cisThree = new Set(cis.musterOffer().units.map((u) => u.type));
    for (const t of ['bx', 'magna']) {
      assert(cisThree.has(t), `${t} declares at:3 and is not on sale in area 3`);
    }
    return `rungs on sale per area: ${rows.join(', ')}; arc/officer/bx/magna all reachable in area 3`;
  });

  check('command: the army comes off the field between areas and goes down once', async () => {
    /**
     * `recall()` HAD NO CALLER ANYWHERE IN THE TREE, and could not safely have
     * had one.
     *
     * The header of `Trooper` says "the Enemy is disposed at the end of every
     * area and rebuilt at the start of the next one" — a claim about a method
     * `grep -rn 'recall' src/` finds defined and never used. So the army never
     * came off the field: survivors stayed wherever the last wave left them, up
     * to eighty metres out, and the next area opened with the line already
     * broken. And the method as it stood nulled `t.body` while leaving the BODY
     * standing, where `deploy()` builds a fresh one for every record whose body
     * is null — one call would have doubled the army with a second, nameless,
     * unpromotable copy.
     *
     * Driven across a real area boundary in a real world, through the shipped
     * path: payWave → _areaClear → recall → autoMuster → closeMuster → deploy.
     */
    const { world, d, input } = await commandWorld({ trim: 1 });
    drive(world, 2, input);
    const live = () => world.enemies.filter((e) => e.trooper && !e.dead).length;
    const before = live();
    assert(before === Cmd.OPENING_STRENGTH, `${before} troopers on the field before the boundary`);
    const names = d.roster.all.map((t) => t.name).join('|');

    d.areaWaves = d.area.waves - 1;
    const paid = d.payWave(d.wave);
    assert(paid, 'the last wave of the area did not pay');
    assert(d.areaIndex === 1, 'the area did not advance');

    /* AND THEY COME IN ON GUNSHIPS NOW, so the boundary is four seconds long.
     * `closeMuster` asks `deploy` for ships — the mode's own first brief has
     * always said "the gunships put you down in the open" and until now the
     * army simply appeared. What that costs this check is a step: the state
     * worth asserting is the one after the flight lands, not the one during
     * it, and the clause below about nobody being deployed twice is exactly
     * what would break if the in-air records were re-ordered every frame. */
    const inAirNow = d.arrivals.pending;
    assert(inAirNow > 0,
      'the area boundary put the army down instantly — nothing was in the air, so the gunships '
      + 'closeMuster asks for are not flying');
    /* WHERE THEY LAND, not where they are fourteen seconds later. A trooper
     * that has been on the ground for eight seconds has been following an
     * order for eight seconds, so measuring at the end of the drive measures
     * the formation solver, not the gunship. Recorded on the frame each body
     * appears. */
    let far = 0;
    const seen = new Set();
    drive(world, 14, input, () => {
      for (const t of d.roster.living) {
        if (!t.body || seen.has(t)) continue;
        seen.add(t);
        far = Math.max(far, Math.hypot(t.body.position.x - world.player.position.x,
          t.body.position.z - world.player.position.z));
      }
      return false;
    });
    assert(d.arrivals.pending === 0, `${d.arrivals.pending} troopers still in the air after fourteen seconds`);

    const after = live();
    assert(after === d.roster.strength,
      `${after} bodies on the field for a roster of ${d.roster.strength} — recall left ghosts behind `
      + 'or deploy built a second copy of the army');
    for (const t of d.roster.living) {
      assert(t.body && !t.body.dead, `${t.name} crossed the boundary without a body`);
      assert(t.body.trooper === t, `${t.name}'s body does not point back at its record`);
    }
    for (const t of d.roster.fallen) assert(!t.body, `${t.name} is dead and still holding a body`);
    /* Every name survives the crossing — the roster is the one object that
     * outlives an area, which is the whole reason it is not the body. */
    assert(names.split('|').every((n) => d.roster.all.some((t) => t.name === n)),
      'a name was lost across the area boundary');
    /* …and they came down AROUND THE COMMANDER rather than staying where the
     * last wave left them, or being set down at the far edge of the spawn
     * ring — which is what the level's own arrival table would have done: on
     * Geonosis it weights the MARCH, deliberately, and the first cut of this
     * put your reinforcements 134 m away on foot. */
    assert(far < 30, `the furthest trooper landed ${far.toFixed(0)} m from the commander`);
    world.unload();
    return `${before} → ${after} bodies for ${d.roster.strength} records across the boundary, `
      + `${inAirNow} flown in, furthest ${far.toFixed(1)} m from the commander`;
  });

  check('command: every formation is a different shape, and the leash bites', () => {
    /* Note #30: "you can order your troops into different formations, circle
     * around you, behind you, in front idk."
     *
     * A formation is a SHAPE and a LEASH, and both have to do something. Six
     * names over one layout is the shape this repository keeps deleting. */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    d._troops(0, {});
    const troops = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(troops.length >= 8, `only ${troops.length} bodies deployed`);

    const shapes = new Map();
    for (const id of Cmd.FORMATION_IDS) {
      d.order(id);
      d._troops(0, {});
      const F = Cmd.FORMATIONS[id];
      const pts = troops.map((e) => {
        const s = d.slotFor(e, new THREE.Vector3());
        return s ? [Math.round(s.x * 4) / 4, Math.round(s.z * 4) / 4] : null;
      });
      if (F.slot(0, 8, 0, new THREE.Vector3()) === null) {
        assert(pts.every((p) => p === null), `${id} claims no slots and produced some`);
        continue;
      }
      const key = JSON.stringify(pts);
      for (const [other, k] of shapes) {
        assert(k !== key, `${id} and ${other} put every body in the identical place`);
      }
      shapes.set(id, key);
    }
    assert(shapes.size >= 4, `only ${shapes.size} of the formations have a shape at all`);

    /* THE THREE THE NOTE NAMES, by geometry rather than by name. `+Z` is the
     * direction the commander faces, so "in front" is a positive mean Z and
     * "behind" is a negative one, and a circle is neither because it surrounds. */
    const meanZ = (id) => {
      d.order(id); d._troops(0, {});
      let s = 0, n = 0;
      for (const e of troops) { const p = d.slotFor(e, new THREE.Vector3()); if (p) { s += p.z; n++; } }
      return n ? s / n : 0;
    };
    assert(meanZ('front') > 3, `"vanguard" has its mean body at z=${meanZ('front').toFixed(1)} — not in front`);
    assert(meanZ('behind') < -2, `"column" has its mean body at z=${meanZ('behind').toFixed(1)} — not behind`);
    d.order('circle'); d._troops(0, {});
    const radii = troops.map((e) => {
      const p = d.slotFor(e, new THREE.Vector3());
      return p ? Math.hypot(p.x, p.z) : 0;
    });
    const rMin = Math.min(...radii), rMax = Math.max(...radii);
    assert(rMin > 2 && rMax - rMin < 4,
      `"circle" runs from ${rMin.toFixed(1)} m to ${rMax.toFixed(1)} m — that is not a ring`);
    // …and it actually surrounds: bodies on both sides of the commander.
    const front = troops.filter((e) => (d.slotFor(e, new THREE.Vector3())?.z ?? 0) > 0).length;
    assert(front > 1 && front < troops.length - 1, 'the "circle" is all on one side');

    /* THE LEASH. This is what makes a formation a tactic rather than a parade:
     * a tight formation will not chase, a charge will. Same body, same enemy,
     * two orders, two answers. */
    const foe = { position: V(0, 0, 26), dead: false, team: 1, alive: true };
    const one = troops[0];
    d.order('circle'); d._troops(0, {});
    assert(d.targetFor(one, [foe]) === null,
      'a trooper in a tight circle engaged something 26 m outside the formation');
    d.order('charge'); d._troops(0, {});
    assert(d.targetFor(one, [foe]) === foe, 'a charging trooper refused a target');
    // …and it never picks its own side, whatever the order.
    const friend = { position: V(0, 0, 1), dead: false, team: one.team, alive: true };
    assert(d.targetFor(one, [friend]) === null, 'a trooper targeted one of its own');
    return `${shapes.size} distinct layouts; front z+${meanZ('front').toFixed(1)}, `
      + `column z${meanZ('behind').toFixed(1)}, circle ${rMin.toFixed(1)}-${rMax.toFixed(1)} m; leash gates`;
  });

  check('command: no order may forbid a body from fighting at its own range', () => {
    /**
     * THE ASSERTION THE OLD LEASH COULD NOT SURVIVE, and it is one line of
     * arithmetic against two tables that already exist.
     *
     * `targetFor` requires a target to be within the leash OF THE TROOPER'S
     * SLOT. The leashes were absolute metres — 5, 6, 7, 8, 10 — and the bodies
     * wearing them fight from 7-15 m (b1), 9-19 (trooper), 11-22 (heavy) and
     * 22-42 (sniper). So "circle around me" ordered ten troopers to stand in a
     * ring and refuse every target their own rifles were built to reach: driven,
     * 0 kills and 72 damage in 70 s, and a sweep in which the kill count tracked
     * the leash number monotonically (5→0, 6→0, 7→1, 8→5, 10→8) and did not
     * respond to the SHAPE at all.
     *
     * The property that forbids that forever: whatever the order, a body may
     * engage at least as far from its slot as its own `preferred[1]`. A
     * formation is allowed to say "do not chase"; it is not allowed to say "do
     * not shoot".
     */
    const worst = [];
    const { d } = dirFor();
    for (const F of Object.values(Cmd.FORMATIONS)) {
      for (const army of Object.values(Cmd.ARMIES)) {
        for (const rung of army.tiers) {
          const A = ARCHETYPES[rung.type];
          const reach = A.preferred?.[1] ?? 0;
          if (!reach) continue;                       // a machine with no band
          const leash = d.leashFor(F, { A });
          assert(leash >= reach - 1e-9,
            `${F.name} leashes a ${A.label} to ${leash.toFixed(1)} m of its slot and the body `
            + `fights from ${reach} m — the order forbids it from using its own weapon`);
          worst.push([F.id, rung.type, leash / reach]);
        }
      }
    }
    /* …and they are still DIFFERENT. A leash that is the same for everybody is
     * the slider-with-N-labels this check exists to prevent, in the other
     * direction. The floor is a share of the table rather than a typed 5, so
     * a seventh order cannot dilute it by simply existing. */
    const spread = new Set(Object.values(Cmd.FORMATIONS).map((F) => F.leash));
    const wantSpread = Math.ceil(Cmd.FORMATION_IDS.length * 0.8);
    assert(spread.size >= wantSpread,
      `${spread.size} distinct leashes over ${Cmd.FORMATION_IDS.length} formations, wanted ${wantSpread}`);
    assert(Cmd.FORMATIONS.charge.leash === Infinity, 'a charge is leashed');
    assert(Cmd.FORMATIONS.circle.leash < Cmd.FORMATIONS.front.leash,
      'a ring around you is not tighter than a screen in front of you');
    const tightest = worst.reduce((a, b) => (b[2] < a[2] ? b : a));
    return `${worst.length} order/body pairs, tightest ${tightest[0]}/${tightest[1]} at `
      + `${tightest[2].toFixed(2)}× its own reach; ${spread.size} distinct leashes`;
  });

  check('command: no field in a formation record is a knob nothing turns', () => {
    /**
     * THE TRIPWIRE THAT WOULD HAVE CAUGHT `fire`, AND IT IS DERIVED FROM THE
     * TABLE RATHER THAN FROM A LIST OF FIELDS.
     *
     * `fire` was declared in FORMATIONS' own note — "a multiplier on how
     * eagerly the troops shoot… 0 is `holdFire`" — read by `_troops`, and set
     * to 1 by every single record. So `if (F.fire <= 0) holdFire(e)` could not
     * be reached by any order the game was able to give: a design number with
     * no caller, which reads as shipped, is quoted in the note above the table
     * as if it were live, and is invisible to every check in this file because
     * every check in this file asks what an order DOES and no order did that.
     *
     * It is the same shape as `command: every event in the MORALE table has
     * something that fires it` and it is the other half of the same argument:
     * that one finds a table entry nothing calls, this finds a table COLUMN
     * that only ever holds one value. A field whose value is constant across
     * every record is not a property of a formation, it is a constant with an
     * extra six copies of itself — and the branch that reads it is dead.
     *
     * Enumerated over the union of every record's keys, so it covers the next
     * field somebody adds without anybody editing this check. Functions are
     * skipped because `slot` is compared by SHAPE in the check above and two
     * formations may legitimately share one; the per-record identity strings
     * are skipped because they are required to be distinct, which is a
     * different property and is asserted elsewhere.
     */
    const records = Object.values(Cmd.FORMATIONS);
    const IDENTITY = new Set(['id', 'name', 'key', 'blurb']);
    const fields = new Set();
    for (const F of records) for (const k of Object.keys(F)) if (!IDENTITY.has(k)) fields.add(k);

    const flat = [];
    for (const k of [...fields].sort()) {
      // `undefined` counts as a value: `urgency` and `seeksCover` are declared
      // by ONE order and absent from the rest, which is a real two-valued knob
      // and is exactly how a formation says "this one is different".
      const seen = new Set(records.map((F) => (typeof F[k] === 'function' ? 'ƒ' : String(F[k]))));
      if (seen.size === 1 && typeof records[0][k] !== 'function') flat.push(`${k}=${[...seen][0]}`);
    }
    assert(!flat.length,
      `${flat.length} of ${fields.size} formation field(s) hold ONE value across all `
      + `${records.length} orders: ${flat.join(', ')} — the branch that reads such a field cannot be `
      + 'reached by any order the game can give, and the note above FORMATIONS describes it as if it '
      + 'could. That is how `fire` shipped: declared, documented, read by `_troops`, and 1 six times');

    /* AND THE ONE THIS WAS WRITTEN FOR, named rather than left to the loop:
     * both sides of the fire gate `_troops` reads must be occupied, or the
     * branch is unreachable in one direction. */
    const holding = records.filter((F) => F.fire <= 0);
    const firing = records.filter((F) => F.fire > 0);
    assert(holding.length && firing.length,
      `${holding.length} order(s) hold fire and ${firing.length} do not — `
      + '`if (F.fire <= 0) holdFire(e)` needs both sides to be a rule rather than a constant');
    return `${fields.size} fields over ${records.length} orders, every one of them varying; `
      + `fire: ${holding.map((F) => F.name).join(', ')} hold, ${firing.length} do not`;
  });

  check('command: the order that holds fire stops the shooting, and the default does not', async () => {
    /**
     * THE BEHAVIOUR, ON A REAL WORLD, COUNTED AT THE ONE DOOR A BOLT COMES OUT
     * OF.
     *
     * The table check above proves `fire` is a knob with two positions. It
     * cannot prove that turning it does anything, and "the field is read by a
     * line of code" is precisely the kind of evidence this repository has been
     * wrong with before — `holdFire` could be called on every trooper every
     * frame and the line could still shoot, because a burst that is already in
     * the air is not a burst that has been cancelled.
     *
     * So this counts BOLTS. `BoltPool.fire` is the single door every blaster
     * round in the game leaves by (`Enemy._fire` and `World._spawnNetBolts`
     * are its only callers), and a bolt is the army's if its owner carries a
     * roster record — which is derived from the thing that makes a trooper a
     * trooper, not from a team number this check would have to know.
     *
     * DERIVED FROM THE TABLE, so it covers the next order: every formation
     * with `fire <= 0` is driven, and the reference is `DEFAULT_FORMATION` —
     * the order the game gives when nobody has said anything.
     *
     * FRESH WORLD PER CONDITION (HANDOFF §2.5) and `enemyRng` seeded the same
     * way for each, so the two lines are shot at by a wave making the same
     * rolls. Measured at 45 game-seconds, over two runs of the suite:
     *
     *     column (the default)    222-223 out, 60-75 incoming
     *     HOLD FIRE                     0 out, 118-129 incoming
     *
     * …and again after the §16.3 bolt fix, the levy and the emplacement made
     * the line something that can be shot at, with the commander held alive
     * (see the drive):
     *
     *     behind (the default)    174 out, 141 incoming, 8 of 10 standing
     *     HOLD FIRE                 0 out, 196 incoming, 10 of 10 standing
     *
     * The out column spreads a little between runs and the reason is worth
     * knowing rather than seeding harder: this suite's async checks interleave
     * at their awaits, so a peer check gets to advance `enemyRng` between the
     * seed and the drive. The property is not a number, which is why the bar
     * below is `> 20` for the reference and `=== 0` for the order.
     *
     * That second column is the one that matters. A zero is also what you get
     * from a line nobody is fighting; a zero while taking HALF AGAIN as many
     * rounds as the order that shoots back is fire discipline. All ten men
     * were still standing at the end of both.
     */
    const SECONDS = 45;
    const drive = async (formation, discipline = 100) => {
      enemyRng.seed(20250814);
      const { world, d, input } = await commandWorld({ formation });
      /**
       * THE LINE IS PINNED DISCIPLINED, AND THAT IS WHAT KEEPS THE ZERO A ZERO.
       *
       * `Attributes.js` gives every man a Discipline score now, and a man
       * below the middle who is being SHOT AT breaks a hold and returns fire —
       * deliberately, and asserted from the other side in `attributes.mjs`. So
       * an unpinned line under this order leaks a few rounds (measured: 3 in
       * 45 s across ten men), which is the feature and not the failure.
       *
       * It is also not this check's subject. The property here is that the
       * ORDER works — the note above argues at length why a zero rather than a
       * small number is what proves it — so the one variable that is under
       * argument elsewhere is held, exactly as the commander's survival is held
       * below and for the same reason. Every man is a 100, nobody has an excuse,
       * and a single bolt out of this line is the order failing.
       */
      for (const t of d.roster.living) if (t.attrs) t.attrs.discipline = discipline;
      let out = 0, incoming = 0;
      const fire = world.bolts.fire.bind(world.bolts);
      world.bolts.fire = (from, dir, opts = {}) => {
        if (opts.owner?.trooper) out++; else incoming++;
        return fire(from, dir, opts);
      };
      /* `_closing` is this file's own rule that a wave with four bodies left
       * stops being a battle and every order comes off — including this one.
       * It is correct and it is not what is being measured, so it is READ and
       * reported rather than assumed away. */
      let closed = false;
      for (let i = 0; i < Math.round(SECONDS / STEP); i++) {
        /**
         * THE COMMANDER IS HELD ALIVE, AND WITHOUT IT THIS CHECK MEASURES A
         * WORLD WITH NO DIRECTOR IN IT.
         *
         * `holdFire` is not a flag on the body. It is a POKE: `_troops` pushes
         * the fuse back up on every trooper on every frame, so the order exists
         * for exactly as long as something is calling it. `World.update` gates
         * `director.update` on `!this.over` — right, and for a stated reason
         * (a director that keeps spawning at a corpse) — so the frame the run
         * ends is the frame every standing order silently lifts.
         *
         * Measured here, idle commander, HOLD FIRE, geonosis, 45 s:
         *
         *     commander dies at s32.7   out 43-121, all of it after s32.7
         *     commander held alive      out 0, 10 of 10 still standing
         *
         * and the reference moved the same way, 222 → 135 → 174, because the
         * back half of its window was a corpse's army too. So the 43 bolts this
         * check failed on were not a line disobeying an order; they were a line
         * with nobody left to give one, counted for twelve seconds after the
         * run it belonged to was over.
         *
         * That the commander now dies inside 45 s of the first engagement at
         * all is a real change and it is NOT this check's subject — it is the
         * roster attrition question in NEXT.md, which is a design call nobody
         * has made. Pinning survival here is the same move `_linetoll.mjs`
         * makes for the same reason: hold the one variable that is under
         * argument elsewhere, so this drive measures fire discipline and only
         * fire discipline. It does not touch a single thing `_troops` reads.
         */
        if (world.player) world.player.hp = world.player.maxHp;
        world.update(STEP, input);
        if (d._closing) closed = true;
        if (world.over) closed = true;
      }
      const standing = d.roster.living.filter((t) => t.body && !t.body.dead).length;
      world.unload();
      return { out, incoming, standing, closed };
    };

    const hold = Object.values(Cmd.FORMATIONS).filter((F) => F.fire <= 0);
    assert(hold.length, 'no order in the table holds fire — see the check above');
    const ref = await drive(Cmd.DEFAULT_FORMATION);
    assert(ref.out > 20,
      `the line fired ${ref.out} bolts in ${SECONDS} s under ${Cmd.DEFAULT_FORMATION} — the reference `
      + 'condition is not a firefight, so nothing below it can mean anything');

    const rows = [`${Cmd.FORMATIONS[Cmd.DEFAULT_FORMATION].name} ${ref.out} out/${ref.incoming} in`];
    for (const F of hold) {
      const r = await drive(F.id);
      rows.push(`${F.name} ${r.out} out/${r.incoming} in`);
      assert(!r.closed,
        `${F.name}: the wave fell to the close-out inside ${SECONDS} s, or the run ended — both lift `
        + 'every order, so this drive is measuring `_updateClosing` and not fire discipline');
      assert(r.out === 0,
        `${F.name} declares fire ${F.fire} and its line still put ${r.out} bolts out in ${SECONDS} s `
        + `against ${ref.out} under ${Cmd.DEFAULT_FORMATION} — \`holdFire\` is being called and the `
        + 'trigger is being pulled anyway');
      assert(r.incoming > 0,
        `${F.name}: nothing shot at the line for ${SECONDS} s, so its 0 is an empty map rather than `
        + 'an order — this drive cannot tell fire discipline from a quiet corner');
      assert(r.standing > 0,
        `${F.name}: the whole line was dead inside ${SECONDS} s, so its 0 is a casualty list`);
    }
    return rows.join('; ') + ` over ${SECONDS} s apiece on geonosis, one fresh World each`;
  });

  check('command: an idle commander\'s army clears a wave by itself', async () => {
    /**
     * DRIVEN, AND IT IS THE CHECK THIS WHOLE SUITE DID NOT HAVE.
     *
     * The player stands still and does nothing. Everything that happens is the
     * army's: the wave is composed by the shipped composer, delivered by the
     * shipped arrivals, fought by ten Enemy bodies with a team number on them,
     * and the clock is `world.update`. Under the old leash this run does not
     * end — measured on this exact fixture, the same seed and the same three
     * bodies: with the leash restored to its old absolute metres the wave was
     * still open at 180 game-seconds with 2 kills; it clears at 57 s with the
     * leash derived from the body's own reach.
     *
     * The wave is trimmed to three bodies for time. Nothing else is touched.
     */
    const { world, d, input } = await commandWorld({ formation: 'circle', trim: 3 });
    assert(d, 'the mode did not build a command director');
    assert(d.roster.strength === Cmd.OPENING_STRENGTH, 'the army did not muster');
    const deployed = world.enemies.filter((e) => e.trooper && !e.dead).length;
    assert(deployed === Cmd.OPENING_STRENGTH,
      `${deployed} of ${Cmd.OPENING_STRENGTH} troopers reached the field`);

    let cleared = -1, closed = false;
    d.onWaveClear = () => { if (cleared < 0) cleared = 1; };
    const t = drive(world, 180, input, () => { closed = closed || !!d._closing; return cleared > 0; });
    const kills = d.roster.all.reduce((n, x) => n + x.kills, 0);
    const alive = world.enemies.filter((e) => d.blocksWaveEnd(e)).length;
    assert(world.player.alive, 'the commander died, so this measured a corpse');
    assert(cleared > 0,
      `wave 1 was still open after ${t.toFixed(0)} game-seconds with ${alive} of the horde alive and `
      + `${kills} kills to a ten-body army — the formation is refusing targets its own weapons reach`);
    assert(kills >= 2, `the wave cleared with only ${kills} kills credited to the roster`);
    /* AND THE CLOSE-OUT ACTUALLY ENGAGED. A driven idle run once stalled from
     * t≈711 s to t=3535 s with two horde bodies alive that the army would not
     * walk to: nothing was stuck, so the watchdog had nothing to say, and the
     * only exit was Abandon. `_closing` is the rule that ends that, and a rule
     * that never fires in a real wave is a rule that does not exist. */
    assert(closed,
      'the wave cleared without the close-out ever engaging — either the last bodies were killed '
      + 'before the queue drained (make the fixture longer) or `_closing` is dead code');
    /* AND THE HUD'S NUMBER IS THE HORDE'S. `remaining` counted your own troops,
     * so it could never reach zero while you had an army. */
    assert(d.remaining === 0,
      `the wave cleared and the readout still says ${d.remaining} remaining — it is counting your own line`);
    world.unload();
    return `cleared at ${t.toFixed(0)}s with an idle commander, ${kills} kills to the roster, `
      + `${d.roster.strength} of ${Cmd.OPENING_STRENGTH} standing`;
  });

  check('command: the steer is installed on the one seam it has, and it moves a body', () => {
    /**
     * PINNED, for the reason `controls.mjs` pins `Player._updateThrow`.
     *
     * `Enemy.update` runs `_think` (which sets `wish` from `target`) and then
     * `_move` (which consumes it). Nothing sits between them, so a formation has
     * to BE the thing between them — `installCommand` wraps `_move` on the
     * instance. Rename that method in Enemy.js and every formation in the game
     * silently becomes a charge, with nothing to see in a diff. This check is
     * what makes that a failure instead.
     */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    d._troops(0, {});
    const e = d.roster.living[0].body;
    assert(e._cmdMove, 'the command steer did not install — Enemy._move has been renamed');
    // Put it a long way off its slot and step it: the wish must point home.
    d.order('circle');
    d._troops(0, {});
    e.position.set(40, 0, 40);
    e.wish = null;
    e._move(1 / 60, {});
    assert(e.wish, 'a trooper 55 m from its slot was given no direction to walk in');
    const slot = d.slotFor(e, new THREE.Vector3());
    const want = new THREE.Vector3(slot.x - 40, 0, slot.z - 40).normalize();
    assert(e.wish.dot(want) > 0.98,
      `the steer points ${(Math.acos(Math.min(1, e.wish.dot(want))) * 180 / Math.PI).toFixed(0)}° off its slot`);
    // `toTarget` too, or `_move`'s backpedal limiter runs a returning trooper at
    // 40% pace and it never arrives.
    assert(e.toTarget && e.toTarget.dot(want) > 0.98,
      'toTarget was not turned with the wish, so the walk home is a backpedal');
    // …and in position it leaves the brain alone entirely.
    e.position.copy(slot);
    e.wish = null;
    e._move(1 / 60, {});
    assert(e.wish === null, 'a trooper standing on its slot is still being steered');
    return 'wrapped on _move; steers home outside the tolerance, silent inside it';
  });

  check('command: the readout says what its field names say, and the wave count is the horde\'s', async () => {
    /**
     * TWO FIELDS THE COMMAND HUD HIT WHILE BEING BUILT, and both were the same
     * mistake in different clothes: a number that describes one thing and is
     * named after another.
     *
     *   `readout().army` — `readout` set `army: this.army.name` and then spread
     *     `roster.summary()` over the top, which carries an `army` of its own
     *     and it is the ID. So the object promised "The Republic" beside a `foe`
     *     of "The Confederacy" and delivered "republic". The HUD worked around
     *     it by looking the id back up in `ARMIES`.
     *
     *   `director.remaining` — the number the HUD prints as "N remaining" and
     *     the number `Net.js` relays to co-op clients. It counted every live
     *     body in `world.enemies`, and Command puts YOUR OWN ARMY in that array,
     *     so a wave of six droids read as sixteen and could not reach zero while
     *     a single trooper of yours was alive. A joining player saw the false
     *     count too.
     *
     * Driven, because `remaining` is only wrong once there is an army standing
     * in the array, which is a fact about a deployed world and not about a
     * getter.
     */
    const { world, d, input } = await commandWorld({ trim: 2 });
    drive(world, 3, input);
    const r = d.readout();
    assert(r.army === d.army.name,
      `readout().army is "${r.army}" where the army is called "${d.army.name}" — it is the id, `
      + 'overwritten by the roster summary spread over the top of it');
    assert(r.foe === d.foe.name, `readout().foe is "${r.foe}"`);
    assert(Cmd.ARMIES[r.armyId] === d.army, 'readout() carries no usable army key');
    assert(Cmd.ARMIES[r.foeId] === d.foe, 'readout() carries no usable foe key');
    /* …and the ROSTER summary keeps the id, because the HUD's roster panel
     * indexes ARMIES with it. The two objects differ on purpose. */
    assert(d.roster.summary().army === d.army.id,
      'CommandRoster.summary().army stopped being the id, which the roster panel indexes ARMIES with');

    const mine = world.enemies.filter((e) => e.trooper && !e.dead).length;
    const horde = world.enemies.filter((e) => !e.trooper && !e.dead).length;
    assert(mine >= 8, `only ${mine} troopers on the field, so this cannot see the defect`);
    assert(d.remaining === d.spawnQueue.length + d.arrivals.pending + horde,
      `the readout says ${d.remaining} remaining with ${horde} of the horde alive, `
      + `${d.spawnQueue.length} queued, ${d.arrivals.pending} inbound and ${mine} troopers of YOURS `
      + 'standing — it is counting your own army as something left to kill');
    world.unload();
    return `army "${r.army}" (${r.armyId}) vs "${r.foe}" (${r.foeId}); `
      + `${d.remaining} remaining against ${horde} hostiles and ${mine} of your own`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Note #29 — allies are as real as enemies                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: your powers reach your own troops and your troops\' rifles do not reach you', () => {
    /**
     * NOTE #29 IS A PAIR OF PROPERTIES THAT PULL AGAINST EACH OTHER, and that
     * is exactly why it is worth a check:
     *
     *   "you can do damage to them and throw them and manipulate them so you
     *    need to be careful not to hurt them" — the player's powers reach them;
     *   "obviously the force blaster-stop thing shouldn't affect your allies'
     *    blasters"                            — and their weapons are not yours.
     *
     * Both fall out of one field, `ctx.rules`, and one team number. Asserted
     * through `canHarm`, which is the ONE gate the game is allowed to answer
     * this question with — so this is testing the shipped rule and not a
     * restatement of it.
     */
    const me = { team: TEAM.PARTY, world: null };
    const mine = { team: TEAM.PARTY, world: null };
    const theirs = { team: 1, world: null };
    const co = { pvp: false, friendlyFire: false };

    // Through the POWERS' rules, an ally is reachable.
    assert(canHarm(me, mine, Cmd.COMMAND_POWER_RULES),
      'a Force push cannot reach your own troops — note #29 asks that it can');
    // Through the WORLD's, a trooper's bolt is not.
    assert(!canHarm(mine, me, co), 'a trooper\'s blaster can shoot the commander');
    assert(!canHarm(mine, { team: TEAM.PARTY }, co), 'a trooper\'s blaster can shoot another trooper');
    // Both directions still fight the other army.
    assert(canHarm(mine, theirs, co), 'your troops cannot hurt the enemy');
    assert(canHarm(theirs, mine, co), 'the enemy cannot hurt your troops');
    // The rules object itself must not be able to become something else.
    assert(Object.isFrozen(Cmd.COMMAND_POWER_RULES), 'the power rules can be mutated by any caller');
    assert(Cmd.COMMAND_POWER_RULES.pvp === false,
      'the power rules turn PvP on, which would put every co-op partner in play');

    /* THE BOLT-STOP, which is the clause the note calls out by name.
     * `Player._stasisCapture` skips `bolt.team === this.team`, so a bolt from
     * one of your troops is skipped BY CONSTRUCTION — the field it reads is the
     * same one that makes them yours. Asserted as the property rather than by
     * driving a Player: the line is `if (!bolt.active || bolt.held ||
     * bolt.team === this.team) continue`, and what matters is that a troop's
     * bolt carries the party's team. */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    const body = d.roster.living[0].body;
    assert(body.team === TEAM.PARTY,
      `a deployed trooper is on team ${body.team}, so the bolt-stop would freeze its fire`);
    return 'powers reach allies; allied bolts reach neither you nor each other; both fight the horde';
  });

  check('command: team damage scales what YOU do and nothing else', () => {
    /* "maybe there's a setting for how much team damage you do." The setting
     * scales DAMAGE and never the physics — a push throws your own sergeant
     * exactly as far as it throws a B1, because the note is explicitly about
     * allies not being a different kind of object. */
    const cfg = Cmd.commandConfig({});
    assert(cfg.teamDamage === Cmd.TEAM_DAMAGE_DEFAULT, 'the default team damage is not the stated one');
    assert(Cmd.commandConfig({ teamDamage: 5 }).teamDamage === 1, 'team damage is not clamped above');
    assert(Cmd.commandConfig({ teamDamage: -1 }).teamDamage === 0, 'team damage is not clamped below');
    assert(Cmd.commandConfig({ teamDamage: 'lots' }).teamDamage === Cmd.TEAM_DAMAGE_DEFAULT,
      'a junk setting is not defaulted');

    const { w, d } = dirFor({ settings: { teamDamage: 0.25 } });
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    const e = d.roster.living[0].body;
    const player = { team: TEAM.PARTY };
    const droid = { team: 1 };
    const hp0 = e.hp;
    e.damage(40, null, player, 'saber');
    const mine = hp0 - e.hp;
    const hp1 = e.hp;
    e.damage(40, null, droid, 'bolt');
    const theirs = hp1 - e.hp;
    assert(Math.abs(mine - 10) < 0.01, `your own hit did ${mine.toFixed(1)} of 40 at a 0.25 setting`);
    assert(Math.abs(theirs - 40) < 0.01, `the enemy's hit did ${theirs.toFixed(1)} of 40 — it must be full`);
    // A source with no team at all is nobody's — a fall, a hazard, a crate — and
    // pays full, which is the same fails-open rule `canHarm` states.
    const hp2 = e.hp;
    e.damage(10, null, null, 'fall');
    assert(Math.abs(hp2 - e.hp - 10) < 0.01, 'an unattributed hit was scaled as friendly fire');

    // At zero, a careless sweep costs nothing at all — which is a legitimate way
    // to play and has to actually be zero rather than nearly.
    const { w: w0, d: d0 } = dirFor({ settings: { teamDamage: 0 } });
    w0.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d0.deploy();
    const safe = d0.roster.living[0].body;
    const before = safe.hp;
    assert(safe.damage(999, null, player, 'saber') === false, 'a zero-team-damage hit reported a kill');
    assert(safe.hp === before, 'team damage 0 still took health');
    return 'own hits ×0.25, enemy hits ×1, unattributed ×1, and 0 is exactly 0';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The wave liveness watchdog — player note #7                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('watchdog: a body nothing can reach does not end the run', () => {
    /**
     * PLAYER NOTE #7, AND IT IS THE WORST BUG ON THEIR LIST because it is the
     * only one that ends a run outright:
     *
     *   "a lot of times I was not able to finish a wave because the enemy would
     *    not be on the map, like the radar would say I'm right on them but idk
     *    maybe they're inside the map but it would keep you from progressing."
     *
     * The wave ends on `!spawnQueue.length && !arrivals.pending && alive === 0`,
     * so ONE unreachable body is a run that never advances again and whose only
     * exit is Abandon. Three states produce it and `Enemy`'s own local stuck
     * handling can resolve none of them: inside geometry, under the terrain, or
     * outside the heightfield.
     *
     * Driven end to end: compose a wave, put its last body somewhere impossible,
     * and assert the wave CLEARS. That is the property — not "the watchdog
     * fired", which is a statement about the fix rather than about the game.
     */
    const w = cmdWorld({ bound: 400 });
    const d = new Waves.WaveDirector(w, { mode: 'waves', pool: ['b1'] });
    w.players.push({ position: V(0, 0, 0), alive: true, team: TEAM.PARTY });
    d.start(1);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(30, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };

    // Run until the wave has put everything down, killing as they land.
    let t = 0;
    while (t < 90 && (d.spawnQueue.length || d.arrivals.pending)) {
      d.update(1 / 60, ctx); t += 1 / 60;
      for (const e of w.enemies) e.dead = true;
    }
    assert(t < 89, 'the wave never finished delivering');

    // Now one body that cannot be reached: 900 m outside a 120 m world.
    const lost = w.spawnEnemy('b1', V(900, 0, 900));
    assert(!Waves.positionIsValid(w, lost), 'the fixture body is not actually in an invalid place');
    assert(d.active, 'the wave had already ended before the stuck body was introduced');

    let cleared = 0;
    d.onWaveClear = () => { cleared++; };
    for (let i = 0; i < 60 * 90 && !cleared; i++) d.update(1 / 60, ctx);
    assert(cleared === 1, 'the wave never cleared — an unreachable body still blocks a run');

    // It was RESCUED before it was retired, and it was not silent.
    const log = d.rescues || [];
    assert(log.length > 0, 'the wave cleared and nothing was logged — the watchdog fired silently');
    assert(log[0].what === 'rescue' && log[0].why === 'invalid position',
      `the first intervention was ${log[0].what}/${log[0].why} — an invalid position must be rescued first`);
    assert(Waves.positionIsValid(w, lost) || lost.dead,
      'the body is still in an impossible place and still alive');
    return `wave cleared with ${log.length} intervention(s): ` + log.map((r) => r.what).join(', ');
  });

  check('watchdog: a body doing its job correctly is never touched', () => {
    /* The other direction, and the one that matters more: a watchdog that
     * teleports a marksman holding its 42 m preferred range is worse than the
     * bug. A real fight is full of thirty-second standoffs. */
    const w = cmdWorld();
    const d = new Waves.WaveDirector(w, { mode: 'waves', pool: ['sniper'] });
    w.players.push({ position: V(0, 0, 0), alive: true, team: TEAM.PARTY });
    d.start(1);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(38, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };
    // A body standing still at a legitimate distance, with the queue empty, for
    // three times the retire clock.
    d.spawnQueue.length = 0;
    d.arrivals.clear();
    const holding = w.spawnEnemy('sniper', V(38, 0, 0));
    for (let i = 0; i < 60 * Waves.STALL_RETIRE * 3; i++) d.update(1 / 60, ctx);
    assert(!holding.dead, 'a marksman holding its own range was retired by the watchdog');
    // …and the two clocks are ordered, so a rescue always precedes a retirement.
    assert(Waves.STALL_RESCUE < Waves.STALL_RETIRE,
      'the retire clock is not after the rescue clock, so nothing is ever rescued');
    assert(Waves.STALL_RESCUE > 8,
      `${Waves.STALL_RESCUE}s of no progress is inside a normal standoff`);
    return `held 38 m for ${(Waves.STALL_RETIRE * 3).toFixed(0)}s untouched; rescue at `
      + `${Waves.STALL_RESCUE}s, retire at ${Waves.STALL_RETIRE}s`;
  });

  check('watchdog: under the ground and outside the world are never legitimate', () => {
    /* Stated as a function rather than as a condition inside the loop, because
     * it is a PROPERTY of this game and a property that only exists inside a
     * check is a property the game does not have. */
    const w = cmdWorld({ bound: 100 });
    const A = ARCHETYPES.b1;
    const at = (x, y, z, a = A) => ({ position: V(x, y, z), A: a });
    assert(Waves.positionIsValid(w, at(0, 0, 0)), 'standing on the ground is not valid');
    assert(Waves.positionIsValid(w, at(0, 40, 0)), 'being in the air is not valid');
    assert(!Waves.positionIsValid(w, at(0, -6, 0)), '6 m under the terrain is valid');
    assert(!Waves.positionIsValid(w, at(400, 0, 0)), 'outside the heightfield is valid');
    assert(!Waves.positionIsValid(w, at(NaN, 0, 0)), 'a NaN position is valid');
    /* A HOVERING BODY IS NOT UNDERGROUND. `float` is real clearance — a jet
     * trooper sits 1.35 m up and a training remote 1.55 — and a tolerance that
     * did not read it would rescue every one of them on the frame it spawned. */
    assert(Waves.positionIsValid(w, at(0, -2.6, 0, ARCHETYPES.jet)),
      'a hovering jet trooper reads as underground');
    return 'ground, air and hover valid; underground, out-of-bounds and NaN are not';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The corpse budget — player note #15                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('corpses: the budget actually bounds the field', () => {
    /**
     * "sometimes for fun I'll spawn like 30 enemies and then it gets really
     * really laggy, framerate probably <10 once there are that many DEAD AND
     * ALIVE enemies on the map."
     *
     * Measured with tools/_crowd.mjs: thirty corpses simulate at 11.46 ms
     * against thirty live bodies at 6.76 and an empty field at 5.30, because a
     * ragdoll is nineteen rigid bodies with joints where a walking enemy is one
     * capsule. Nothing in this repository had ever removed one, and a forty-wave
     * run leaves several hundred.
     *
     * The property is the BOUND: however many die, the number kept is bounded by
     * the tier's budget. Asserted by killing four times the budget and counting.
     */
    const budget = 6;
    const w = cmdWorld();
    w.player = { position: V(0, 0, 0), aimDir: V(0, 0, 1) };
    const c = new Corpses(w, { budget });
    for (let i = 0; i < budget * 4; i++) {
      const e = w.spawnEnemy('b1', V(i * 3, 0, 0));
      e.dead = true;
      e.actor = null;                            // no ragdoll: settles at once
      c.take(e);
    }
    assert(c.list.length === budget * 4, 'the ledger did not take every body');
    // Long enough for the settle hold and a full sink.
    for (let i = 0; i < 60 * 6; i++) c.update(1 / 60);
    assert(c.list.length <= budget,
      `${c.list.length} corpses are still on the field against a budget of ${budget}`);
    assert(c.retired >= budget * 3,
      `only ${c.retired} of ${budget * 3} surplus corpses were retired`);

    // The tiers are ordered and every one of them is a real bound.
    const tiers = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < tiers.length; i++) {
      assert(CORPSE_BUDGET[tiers[i]] > CORPSE_BUDGET[tiers[i - 1]],
        `the ${tiers[i]} tier does not keep more corpses than ${tiers[i - 1]}`);
    }
    assert(CORPSE_BUDGET.low >= 4, 'the lowest tier keeps so few that a wave\'s dead vanishes under you');
    /* AND THE WORLD HAS TO ACTUALLY OWN ONE. A budget nothing constructs is the
     * defect this whole repository is shaped around — a table beside a consumer
     * that ignores it. Read off the source rather than by building a World,
     * which needs Rapier and a GPU-shaped scene. */
    const src = String(new URL('../../src/game/World.js', import.meta.url).pathname);
    const text = require$(src);
    assert(/new Corpses\(/.test(text), 'World never constructs a corpse ledger');
    assert(/corpses\?\.take\(/.test(text), 'nothing hands a dead body to the ledger');
    assert(/corpses\?\.update\(/.test(text), 'the ledger is never stepped');
    assert(/corpses\?\.clear\(/.test(text), 'the ledger is not cleared when a level unloads');
    return `${budget * 4} dead → ${c.list.length} kept, ${c.retired} retired; `
      + `tiers ${tiers.map((t) => CORPSE_BUDGET[t]).join('/')}; World wires all four calls`;
  });

  check('command: the formation holds its heading, keeps out of the blade, and can be planted', () => {
    /**
     * NOTE #23, and its three clauses are three different things going wrong
     * around one shape.
     *
     * "it's really strange it's like your troops are locked into the direction
     * you're facing like if you were to spin they would rotate around you like
     * a clock" — `_frame` read `player.aimDir`, live, every frame. A flick of
     * the mouse swung a twelve-man line bodily around the player.
     *
     * "the troops are totally in the way of your saber like they don't avoid
     * it at all and crowd you" — nothing in the solver knew the commander was
     * holding one. The slots are clear of a blade; the traffic to and from
     * them is not.
     *
     * "there should be an option where you can tell your troops to get into a
     * certain formation and hold it and stay there regardless of where you
     * are" — there was not, except as one order's baked-in property.
     */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me);
    /* THE COMMANDER'S OWN PLAYER, which is what `_frame` reads. `world.player`
     * is where the director takes it from at construction and this stub has
     * only `players`, so without this the frame falls back to the anchor and
     * every clause below measures a formation nobody is standing in. */
    w.player = me; d.commander.player = me;
    d.deploy();
    d.order('line');
    const troops = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(troops.length >= 6, `only ${troops.length} bodies to measure`);
    const slots = () => troops.map((e) => d.slotFor(e, new THREE.Vector3()).clone());
    /* ONE TICK FIRST. `cmdIndex`, `cmdCount` and `cmdSquad` are written by
     * `_troops`, and a slot solved before that is every trooper's slot zero —
     * so a `before` sampled cold and an `after` sampled warm differ by the
     * whole width of the formation and this would measure the numbering. */
    d._troops(1 / 60, {});

    /* ── 1. LOOKING ABOUT DOES NOT MOVE THE LINE. */
    const before = slots();
    for (let i = 0; i < 40; i++) {
      me.aimDir.set(Math.sin(i * 0.15), 0, Math.cos(i * 0.15));   // sweeping the mouse
      d._troops(1 / 60, {});
    }
    const after = slots();
    let moved = 0;
    for (let i = 0; i < before.length; i++) moved = Math.max(moved, before[i].distanceTo(after[i]));
    assert(moved < 0.5,
      `sweeping the aim through 90 degrees moved a slot ${moved.toFixed(1)} m — the formation is `
      + 'solved in the AIM frame and rotates round the player like a clock');

    /* ── 2. …AND TURNING THE BODY DOES, eventually. The deadband is 40 degrees
     * and the slew 1.1 rad/s, so a half turn arrives in about two seconds. */
    me.facing = Math.PI;
    for (let i = 0; i < 240; i++) { d._troops(1 / 60, {}); }
    const turned = slots();
    let swung = 0;
    for (let i = 0; i < before.length; i++) swung = Math.max(swung, before[i].distanceTo(turned[i]));
    assert(swung > 2,
      `the commander turned right around and the furthest slot moved ${swung.toFixed(1)} m — the `
      + 'formation is not following the commander at all');

    /* ── 3. NOBODY STANDS IN THE SWING. Put every trooper on top of the
     * commander and step: they clear. */
    me.facing = 0;
    for (const e of troops) { e.position.set(0.4, 0, 0.2); e.target = null; }
    for (let i = 0; i < 60; i++) { d._troops(1 / 60, {}); }
    let closest = Infinity;
    for (const e of troops) closest = Math.min(closest, Math.hypot(e.position.x, e.position.z));
    assert(closest > 2.4,
      `a trooper is standing ${closest.toFixed(2)} m from the commander — inside the blade's own `
      + 'working volume, which is what "they are in the way of your saber" is');

    /* ── 4. HOLD. Planted, the shape stays where it was put no matter where
     * the commander goes; released, it comes back with them. */
    const held = d.hold(true);
    assert(held === true, 'hold(true) did not take');
    const plantedAt = slots();
    me.position.set(40, 0, -25);
    for (let i = 0; i < 60; i++) { d._troops(1 / 60, {}); }
    const stillThere = slots();
    let drift = 0;
    for (let i = 0; i < plantedAt.length; i++) drift = Math.max(drift, plantedAt[i].distanceTo(stillThere[i]));
    assert(drift < 0.5,
      `the commander walked 47 m and a held slot followed ${drift.toFixed(1)} m of it`);
    /**
     * …AND RELEASED IT COMES BACK — AT THE LINE'S OWN PACE, NOT AT ONCE.
     *
     * THE PREMISE OF THIS CLAUSE EXPIRED, and the expiry is the feature. It
     * used to read the slots on the frame `hold(false)` was called and require
     * them to have moved 20 m already, which was true because `_frame` returned
     * the commander's LIVE POSITION: the formation's anchor teleported wherever
     * the player was, every frame, at any speed.
     *
     * FLAGSHIP §6 makes that a rule instead of an accident — "the objective
     * advances at the pace of the slowest friendly inside 14 m … walking 35 m
     * forward drags the whole formation with you and costs 4 of 10 men" — so
     * the anchor is now speed-limited (`CommandDirector.advancePace`). Both
     * halves are checked: it does NOT arrive in one frame, and it DOES arrive.
     */
    d.hold(false);
    const atRelease = slots();
    let instant = 0;
    for (let i = 0; i < plantedAt.length; i++) instant = Math.max(instant, plantedAt[i].distanceTo(atRelease[i]));
    assert(instant < 20,
      `the formation crossed ${instant.toFixed(1)} m in the frame the hold was released — the anchor `
      + 'is still teleporting to the commander, which is the accident §6 replaces');
    /* AND IT DOES NOT COME AT ALL WHILE HE IS 47 m AWAY, which is the other
     * half of the same rule and the reason this clause could not simply be
     * given a longer window: with no living friendly inside `MORALE.NEAR` the
     * pace is zero and the line holds the ground it is on. That is §6 in one
     * sentence — "you can sprint 200 m into their rear; the line does not come
     * with you" — so the commander has to come back to be followed. */
    assert(d.advancePace(d.commander) === 0,
      `a commander 47 m from every man he has still advances the line at `
      + `${d.advancePace(d.commander).toFixed(1)} m/s`);
    for (let i = 0; i < 600; i++) d._troops(1 / 60, {});
    const abandoned = slots();
    let crept = 0;
    for (let i = 0; i < plantedAt.length; i++) crept = Math.max(crept, plantedAt[i].distanceTo(abandoned[i]));
    assert(crept < 20,
      `ten seconds after the release the formation had crossed ${crept.toFixed(1)} m toward a `
      + 'commander it has nobody within 14 m of — the pace rule is not holding the line');

    /* …AND IT DOES COME when he is back among them. Long enough for the walk
     * at the line's own pace and no longer: a generous wall-clock window is a
     * check that passes whatever the rule says. */
    const anchorNow = d.commander._paceAnchor.clone();
    me.position.set(anchorNow.x + 9, 0, anchorNow.z);
    const pace = d.advancePace(d.commander);
    assert(pace > 0, 'a commander standing 9 m from his line still cannot advance it');
    const need = Math.ceil((9 / pace) * 60) + 120;
    for (let i = 0; i < need; i++) d._troops(1 / 60, {});
    const released = slots();
    let came = 0;
    for (let i = 0; i < plantedAt.length; i++) came = Math.max(came, plantedAt[i].distanceTo(released[i]));
    assert(came > 6,
      `released, and given ${(need / 60).toFixed(0)}s at the line's own ${pace.toFixed(1)} m/s with `
      + `the commander 9 m away, the formation moved ${came.toFixed(1)} m`);
    return `aim sweep moved a slot ${moved.toFixed(2)} m, a body turn ${swung.toFixed(1)} m; `
      + `blade room ${closest.toFixed(2)} m; held drift ${drift.toFixed(2)} m, released ${came.toFixed(0)} m`;
  });

  check('command: TAKE COVER is run, and it goes to something', () => {
    /* "i noticed when I order take cover they don't really run for their
     * lives." Every order shared one walk-home pace, and that pace is derived
     * from how fast the COMMANDER is going — so ordering a standing squad to
     * ground asked them to amble to it. And the order ignored every crate on
     * the level, which makes it a scatter with a good name. */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me);
    w.player = me; d.commander.player = me;
    d.deploy();
    const troops = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(troops.length >= 6, 'not enough bodies');

    /* THE PACE. `followSpeed` is the one statement of it, so the claim is
     * measured there rather than by racing two simulations. */
    d.order('line');
    const walk = troops.map((e) => d.followSpeed(e, 12));
    d.order('cover');
    const run = troops.map((e) => d.followSpeed(e, 12));
    const ratio = run.reduce((a, b) => a + b, 0) / Math.max(1e-6, walk.reduce((a, b) => a + b, 0));
    assert(ratio > 1.4,
      `an order to take cover moves at ${ratio.toFixed(2)}x the pace of an order to form a line — `
      + 'they are not running for their lives, they are ambling to it');

    /* AND IT GOES TO SOMETHING. One crate-sized static box near the squad, and
     * a threat on the far side of the commander: the slots move to its lee. */
    const box = { center: V(9, 0.9, 3), halfExtents: V(1.2, 1.0, 1.2),
      quat: null, radius: 2, disabled: false };
    w.physics.staticBoxes.push(box);
    w.enemies.push({ position: V(-40, 0, 0), dead: false, trooper: null });
    d.order('cover');                            // re-solve against the new field
    let behind = 0;
    for (const e of troops) {
      const s = d.slotFor(e, new THREE.Vector3());
      if (!s) continue;
      // behind means: within a couple of metres of the box, on the far side
      // from the threat, which is at -x
      if (Math.hypot(s.x - box.center.x, s.z - box.center.z) < 3.2 && s.x > box.center.x) behind++;
    }
    assert(behind >= 1,
      'not one trooper taking cover chose the only object on the level to get behind');
    return `cover runs at ${ratio.toFixed(2)}x a line's pace; ${behind} of ${troops.length} took the lee of the crate`;
  });


  check('command: a squad has somebody in charge, and the job passes down', () => {
    /* Note #30: "Troops should have a squad commander/hierarchy if they
     * already don't, certain roles are replaced if that person falls in
     * combat, other's are not."
     *
     * The leader is DERIVED — highest rank, then experience — which is the
     * whole of "replaced if that person falls": there is no field to clear
     * and no promotion to schedule, the question is asked rather than
     * remembered. */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const squad = d.roster.squads()[0];
    assert(squad.length >= 3, `a squad of ${squad.length}`);
    // Everyone starts a Trooper, so the leader is decided by xp — give one some.
    squad[1].award(12);
    const lead = d.leaderOf(squad);
    assert(lead === squad[1],
      `the highest-ranked man is not the leader (${lead?.name} vs ${squad[1].name})`);
    const before = squad.map((t) => t.morale);

    /* HE FALLS. The squad takes it harder than it takes a rifleman, somebody
     * steps up on the same frame, and the promotion is paid. */
    const heirWas = d.leaderOf(squad.filter((t) => t !== squad[1]));
    const heirXp = heirWas.xp;
    d.onDeath(lead.body, null);
    assert(!lead.alive, 'the leader survived being killed');
    const now = d.leaderOf(d.squadOf(heirWas));
    assert(now === heirWas, `nobody took the squad: ${now?.name}`);
    assert(heirWas.xp > heirXp, 'the man who took over was not paid for it');
    const dropped = before[0] - squad[0].morale;
    assert(dropped > 0.2,
      `losing the squad leader cost the man beside him ${dropped.toFixed(2)} of morale`);

    /* AND A RIFLEMAN COSTS LESS THAN A LEADER. */
    const { d: d2 } = (() => { const r = dirFor(); r.w.players.push(me); r.w.player = me;
      r.d.commander.player = me; r.d.deploy(); return r; })();
    const sq2 = d2.roster.squads()[0];
    sq2[0].award(12);                                     // make someone else the leader
    const watcher = sq2[2], m0 = watcher.morale;
    d2.onDeath(sq2[1].body, null);                        // a plain trooper falls
    const plain = m0 - watcher.morale;
    assert(plain > 0 && plain < dropped,
      `a rifleman falling cost ${plain.toFixed(2)} and a leader ${dropped.toFixed(2)} — `
      + 'the hierarchy has no weight in it');
    return `leader by rank then xp; succession paid; leader ${dropped.toFixed(2)} vs rifleman ${plain.toFixed(2)} of morale`;
  });

  check('command: a squad that breaks stops holding the line, and can be rallied', () => {
    /* Note #36: "Heavy losses, Dark-side excess, or abandoning them tanks
     * morale — they can break, refuse orders, or even turn on you."
     *
     * Three consequences and each is measured through the thing that consumes
     * it: the aim model, the steer, and the target picker. */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const t = d.roster.living[0];
    const e = t.body;
    e.position.set(0, 0, 26);
    e.trooper = t;

    /* 1. NERVE IS ACCURACY. Measured through `Enemy.aimQuality`, which is the
     * one place a spread is decided, on a real Enemy rather than on a stub. */
    const real = new Enemy(w, 'trooper', V(0, 0, 26));
    real.trooper = t;
    t.morale = 1.0; const steady = real.aimQuality(20);
    t.morale = 0.05; const shaken = real.aimQuality(20);
    assert(shaken > steady * 1.4,
      `a terrified trooper shoots at ${(shaken / steady).toFixed(2)}x a steady one's spread`);

    /* 2. A BROKEN MAN FALLS BACK TOWARD YOU. Toward, deliberately: a rout that
     * scatters is one the player can do nothing about. */
    t.morale = 0.15; t.broken = true;
    e.wish = null;
    d.steer(e, 1 / 60);
    assert(e.wish, 'a broken trooper was given no direction at all');
    const toward = e.wish.x * (me.position.x - e.position.x) + e.wish.z * (me.position.z - e.position.z);
    assert(toward > 0, 'a broken trooper ran away from its commander rather than to them');

    /**
     * 3. AND ONE THAT IS FINISHED TAKES NO ORDER — WHICH IS NOT THE SAME AS
     *    DOING NOTHING, AND IT USED TO BE.
     *
     * This step asserted `!e.wish` after one `steer`, and the property it was
     * holding down turned out to be the defect: `steer` returned outright below
     * `REFUSE`, `targetFor` returned null on the same test, and the result was a
     * man with no wish, no target and no pose. Measured on a real Geonosis with
     * a real army, 100.0% of his frames were motionless, upright and silent for
     * the whole twenty-second window. The player: "them frozen still looks like
     * a bug almost and it happens everywhere."
     *
     * The THRESHOLD is untouched and both halves of it are still asserted here
     * — no target, and no walk to a formation slot. What is asserted instead of
     * the freeze is that he does something of his own: he goes to ground.
     * `CommandDirector._goToGround` is the behaviour and tools/checks/nerve.mjs
     * is the measurement.
     */
    t.morale = 0.02; t.broken = true;
    e.wish = null; e.crouch = 0; e.cmdSlotDist = -1;
    let acted = 0;
    for (let i = 0; i < 180; i++) {
      e.wish = null;
      d.steer(e, 1 / 60);
      if (e.wish && e.wish.lengthSq() > 1e-6) acted++;
    }
    assert(d.targetFor(e, w.enemies) === null, 'a trooper past refusing still picked a target');
    assert(e.cmdSlotDist === -1, 'a trooper past refusing was still solving a formation slot');
    assert(acted > 0 && e.crouch > 0.6,
      `a trooper past refusing stood there: ${acted} of 180 frames with anywhere to go, `
      + `crouch ${(e.crouch || 0).toFixed(2)}`);

    /* 4. RALLIED. Standing with them is what buys it back, and the table says
     * so — JEDI_NEAR is the largest per-second term in it. */
    t.morale = 0.3; t.broken = false;
    e.position.set(1, 0, 1);
    for (let i = 0; i < 300; i++) d._morale(1 / 60, d.commander);
    assert(t.morale > 0.55,
      `five seconds beside their commander took a shaken trooper to ${t.morale.toFixed(2)}`);
    /* …and being left alone costs it. */
    e.position.set(120, 0, 120);
    const high = t.morale;
    for (let i = 0; i < 600; i++) d._morale(1 / 60, d.commander);
    assert(t.morale < high, 'a trooper abandoned across the level lost no nerve at all');
    return `spread ${(shaken / steady).toFixed(2)}x when broken; falls back to the commander; `
      + `refuses under ${Cmd.MORALE?.REFUSE ?? 0.1} and goes to ground instead `
      + `(${acted}/180 frames moving, crouch ${(e.crouch || 0).toFixed(2)}); rallied ${t.morale.toFixed(2)}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The commander's own Force, and the line that reacts               */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * A commander stub with a real Force economy on it.
   *
   * `_spend`, `_canSpend`, `_priceOf` and `_refuse` are the four methods
   * `Player.js` charges every one of its nine powers through, and the whole
   * point of asserting against a stub that HAS them is that a director doing
   * its own `force -= cost` arithmetic would pass a test written against a
   * plain object and fail here. The drain multiplier is the one thing that
   * makes the difference visible: this pays 2x list, so a director quoting the
   * list price is caught by the refusal text as well as by the balance.
   */
  const forceful = (opts = {}) => {
    const drain = opts.drain ?? 1;
    return {
      position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY,
      force: opts.force ?? 100, refusals: [],
      _canSpend(c) { return this.force >= c * drain; },
      _spend(c) { if (!this._canSpend(c)) return false; this.force -= c * drain; return true; },
      _priceOf(c) { return Math.round(c * drain); },
      _refuse(name, why) { this.refusals.push(`${name}: ${why}`); return false; },
    };
  };

  check('command: RALLY is a Force verb that reaches a LINE, and it is priced like one', () => {
    /**
     * The commander half of the note: a Jedi general's contribution to a
     * battle is not that they can throw one soldier further than another
     * soldier can. RALLY is one of the two verbs in `COMMAND_FORCE`, and every
     * clause of what it claims is checkable — it costs Force through the
     * player's own spender, it has a cooldown that runs down on the clock, it
     * reaches a radius rather than a body, and what it hands out is state that
     * already existed on the far side.
     */
    const { w, d } = dirFor();
    const me = forceful();
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const troops = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(troops.length >= 6, `only ${troops.length} bodies`);

    const P = Cmd.COMMAND_FORCE.rally;
    /* ONE OF THEM IS BROKEN AND ONE OF THEM IS FINISHED. INSPIRED is 0.16 and
     * BREAK is 0.24, so the first comes back and the second cannot — which is
     * the property, and it is two numbers in the MORALE table rather than a
     * threshold this verb invented. */
    const shaken = d.roster.living[0], done = d.roster.living[1], far = d.roster.living[2];
    shaken.morale = 0.14; shaken.broken = true;
    done.morale = 0.01; done.broken = true;
    far.morale = 0.14; far.broken = true;
    far.body.position.set(0, 0, P.radius + 25);

    const before = me.force;
    assert(d.order('rally') === true, 'the order door does not answer for a Force verb');
    assert(me.force < before, 'a commander Force verb was free');
    assert(Math.abs((before - me.force) - P.cost) < 1e-6,
      `RALLY charged ${(before - me.force).toFixed(1)} against a list price of ${P.cost}`);
    assert(!shaken.broken, `a rallied man at ${shaken.morale.toFixed(2)} is still broken`);
    assert(done.broken, 'a rally brought back a man who had already given up');
    assert(far.broken, `a man ${(P.radius + 25).toFixed(0)} m away was rallied from inside the radius`);
    assert(shaken.body.rallyTimer >= P.seconds,
      'a rallied body carries no rallyTimer — it is a morale event with no fighting in it');
    assert(!(far.body.rallyTimer > 0), 'the aura reached outside the radius');

    /* …AND IT DOES NOT BECOME THE ORDER. A verb that set `formation` would put
     * a line into a shape with no `slot` function on the very next frame. */
    assert(d.commander.formation !== 'rally',
      'casting a Force verb changed the standing formation');
    assert(Cmd.commandConfig({ commandFormation: 'rally' }).formation === Cmd.DEFAULT_FORMATION,
      'a Force verb was accepted as a STANDING formation');

    /* THE COOLDOWN IS REAL AND IT RUNS DOWN ON THE CLOCK. */
    const held = me.force;
    assert(d.order('rally') === false, 'RALLY fired twice in one frame');
    assert(me.force === held, 'a refused verb still charged for it');
    assert(/recovering/.test(me.refusals[me.refusals.length - 1] || ''),
      `a refusal that does not say why: ${me.refusals[me.refusals.length - 1]}`);
    for (let i = 0; i < Math.ceil(P.cd * 30) + 2; i++) d._troops(1 / 30, {});
    assert(d.castReady('rally', d.commander) === null,
      `RALLY never came off cooldown after ${P.cd}s of frames`);

    /* AND THE PRICE IS THE PLAYER'S TO QUOTE. Force Drain doubles it; a
     * director that had typed the list price into its own refusal would say
     * the wrong number here. */
    const poor = forceful({ drain: 2, force: P.cost });
    d.commander.player = poor;
    assert(d.order('rally') === false, 'RALLY fired with half the Force it costs');
    assert(new RegExp(`${P.cost * 2} Force needed`).test(poor.refusals[0] || ''),
      `the refusal quotes "${poor.refusals[0]}" where Force Drain 2x charges ${P.cost * 2}`);
    return `RALLY at ${P.cost} Force, ${P.radius} m, ${P.seconds}s of aura; broke→steady, `
      + `refused at 0.01 morale, ${P.cd}s cooldown, and 2x drain quoted as ${P.cost * 2}`;
  });

  check('command: DREAD takes the shot, the aim and the footing — and none of the health', () => {
    /**
     * "expressed as physics and morale rather than as damage numbers." DREAD
     * is the verb that had to earn that sentence, because the easy version of
     * a commander power aimed at the enemy is a bigger Force lightning. Four
     * consequences and the health bar is not one of them.
     */
    const { w, d } = dirFor();
    const me = forceful();
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const P = Cmd.COMMAND_FORCE.dread;

    /* Real Enemies, not stubs: `applyKnockback`, `aimQuality` and the burst
     * clock are all real methods and the claim is about what they do. */
    const front = new Enemy(w, 'b1', V(0, 0, 12));
    const behind = new Enemy(w, 'b1', V(0, 0, -12));
    const away = new Enemy(w, 'b1', V(0, 0, P.radius + 14));
    for (const e of [front, behind, away]) { e.team = 1; w.enemies.push(e); }
    const mine = d.roster.living[0].body;
    mine.position.set(0, 0, 6);
    const hp0 = front.hp, aim0 = front.aimQuality(20);
    front.burstLeft = 3; front.attackTimer = 0;

    assert(d.order('dread') === true, 'DREAD did not fire');
    /* THE SHOT. `holdFire` is Waves.js's own primitive and it is what the HOLD
     * FIRE order uses — the burst is gone and the fuse is back up. Two callers
     * of one primitive, which is the reason a verb and an order can silence a
     * droideka mid-burst and a marksman mid-telegraph with no second rule. */
    assert(front.burstLeft === 0 && front.attackTimer >= 0.5,
      `the burst survived: ${front.burstLeft} left, fuse ${front.attackTimer.toFixed(2)}`);
    /* THE AIM, through the one function that decides a spread. */
    assert(front.aimQuality(20) > aim0 * 1.2,
      `a body under dread shoots at ${(front.aimQuality(20) / aim0).toFixed(2)}x its own spread`);
    /* THE FOOTING — and it is a shove away from the commander, not a pull. */
    assert(front.velocity.lengthSq() > 1,
      'a body under dread was not moved at all — the physics half is missing');
    assert(front.velocity.z > 0, 'the shove went toward the commander rather than away');
    /* AND NONE OF THE HEALTH. */
    assert(front.hp === hp0, `DREAD took ${(hp0 - front.hp).toFixed(1)} hp — it is a damage button`);

    /* THE ARC AND THE RADIUS BOTH BITE, and your own line is never in it. */
    assert(behind.dread === 0, 'DREAD reached behind the commander — it has no frontage');
    assert(away.dread === 0, `DREAD reached ${P.radius + 14} m against a radius of ${P.radius}`);
    assert(!(mine.dread > 0), 'DREAD landed on one of your own');
    return `${P.cost} Force, ${P.radius} m, ±${(P.arc * 180 / Math.PI).toFixed(0)}°: burst gone, `
      + `spread ${(front.aimQuality(20) / aim0).toFixed(2)}x, |v| ${front.velocity.length().toFixed(1)} m/s, `
      + `0.0 hp; the man behind and the man beyond took nothing`;
  });

  check('command: DREAD shakes a record where there is one, and MORALE is where it says so', () => {
    /* The fourth consequence, and it only exists in a MEETING: a campaign's
     * enemy carries no roster record, which is exactly why the aim term lives
     * on the body (see DREAD in Enemy.js). Two armies is where the table's
     * own SHAKEN entry is reachable. */
    const { w, d } = dirFor();
    const me = forceful(), them = { position: V(0, 0, 60), aimDir: V(0, 0, -1), facing: Math.PI, alive: true, team: 2 };
    w.players.push(me, them); w.player = me;
    d.commander.player = me;
    const foe = d.enlistCommander({ player: them, side: 2, army: Cmd.ARMIES.separatist,
      anchor: V(0, 0, 30), facing: Math.PI });
    d.deployAll();
    const near = foe.roster.living.find((t) => t.body && t.body.position.distanceTo(V(0, 0, 0)) < Cmd.COMMAND_FORCE.dread.radius);
    assert(near, 'no enemy trooper landed inside the radius to shake');
    const was = near.morale;
    d.order('dread');
    assert(near.morale < was - 0.1,
      `an enemy trooper inside DREAD lost ${(was - near.morale).toFixed(2)} of nerve`);
    return `SHAKEN ${Cmd.MORALE.SHAKEN} on the record: ${was.toFixed(2)} → ${near.morale.toFixed(2)}`;
  });

  check('command: every event in the MORALE table has something that fires it', () => {
    /**
     * THE TRIPWIRE THIS TABLE WAS MISSING, and it caught three.
     *
     * `WAVE_CLEAR` (0.34, the second largest event in the table), `INSPIRED`
     * and `BETRAYED` were declared, documented, and called by NOTHING. A
     * number in a design table with no caller is worse than a missing feature:
     * it reads as shipped, it is quoted in the note above the table as if it
     * were live, and the only way to find out is to grep for it.
     *
     * Derived, not listed. Every key of `MORALE` has to appear in Command.js
     * as either `MORALE.KEY` — how a per-second drift or a threshold is read —
     * or `'KEY'`, which is how an event reaches `shake`. The DECLARATION does
     * not match either form (it is `KEY:`, unquoted), so a key that is only
     * declared fails, which is the whole point. Comments are stripped first,
     * or the prose above the table would satisfy the check on its own.
     */
    const src = require$(new URL('../../src/game/Command.js', import.meta.url))
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const orphans = Object.keys(Cmd.MORALE).filter((k) =>
      !new RegExp(`MORALE\\.${k}\\b`).test(src) && !src.includes(`'${k}'`));
    assert(!orphans.length,
      `${orphans.length} of ${Object.keys(Cmd.MORALE).length} entries in the MORALE table are `
      + `declared and never used: ${orphans.join(', ')} — a design number with no caller`);
    return `${Object.keys(Cmd.MORALE).length} morale entries, every one of them reachable`;
  });

  check('command: throwing one of your own with the FORCE is a betrayal; a stray cut is an accident', () => {
    /* Note #36's "Dark-side excess" clause, which was the one third of the
     * sentence with no arithmetic behind it. The distinction is deliberate:
     * team damage already prices a clumsy sweep in health, where reaching out
     * and throwing a soldier of yours into a wall is a decision. */
    const { w, d } = dirFor();
    const me = forceful();
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const t = d.roster.living[0], e = t.body;
    const squad = d.squadOf(t);
    const blade0 = squad.map((x) => x.morale);
    e.damage(4, null, me, 'blade');
    assert(squad.every((x, i) => x.morale === blade0[i]),
      'a stray sword cut shook the squad — that is friendly fire, not the dark side');

    const was = squad.map((x) => x.morale);
    e.damage(4, null, me, 'force');
    const drop = was[0] - squad[0].morale;
    assert(Math.abs(drop - (-Cmd.MORALE.BETRAYED)) < 1e-6,
      `a Force power through one of your own cost the squad ${drop.toFixed(3)} against `
      + `BETRAYED's ${Cmd.MORALE.BETRAYED}`);
    /* …and once, not sixty times: one push through a squad is one betrayal. */
    const after = squad[0].morale;
    e.damage(4, null, me, 'force');
    assert(squad[0].morale === after, 'the second body in the same push was a second betrayal');
    return `blade 0.000, force ${drop.toFixed(2)}, and the same push does not bill twice`;
  });

  check('command: troops use the ground when they are shot at, and the formation survives it', () => {
    /**
     * "they should take cover when under fire." The order TAKE COVER already
     * existed and this is the other thing — a man inside a formation using
     * what is beside him — which is why it is the SAME hunt with a different
     * radius rather than a second cover system. The property that matters is
     * the bound: the ordered hunt may cross the level, this one may not leave
     * the shape.
     */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.order('line');
    d.deploy();
    d._troops(1 / 30, {});
    const e = d.roster.living[0].body;
    const dry = d.slotFor(e, new THREE.Vector3()).clone();

    /* A crate a step and a half off that man's mark, and a threat behind us. */
    const box = { center: V(dry.x + 2.2, 0.9, dry.z), halfExtents: V(1.0, 1.0, 1.0),
      quat: null, radius: 2, disabled: false };
    w.physics.staticBoxes.push(box);
    w.enemies.push({ position: V(0, 0, -60), dead: false, trooper: null });
    d._threatAt = -1;

    assert(!(e.underFire > 0), 'a trooper nobody has shot at is already under fire');
    const same = d.slotFor(e, new THREE.Vector3()).clone();
    assert(same.distanceTo(dry) < 1e-6, 'the slot moved with no fire on it at all');

    /* SHOT AT — through the real damage door, so this is the path the game
     * takes rather than a field set by hand. */
    e.damage(3, null, { team: 9 }, 'blaster');
    assert(e.underFire > 0, 'a hostile hit did not mark the man as being under fire');
    const wet = d.slotFor(e, new THREE.Vector3()).clone();
    const moved = wet.distanceTo(dry);
    assert(moved > 0.5, 'a trooper under fire stood exactly where it was — it ignored the crate');
    assert(wet.z > box.center.z,
      'it went to the side of the crate the shooting is coming from');
    const bound = Cmd.COVER_LEAN + Math.max(box.halfExtents.x, box.halfExtents.z) + 1;
    assert(moved <= bound,
      `it walked ${moved.toFixed(1)} m off its mark for cover, past the ${bound.toFixed(1)} m `
      + 'the formation can absorb — this is a rout with a good name');

    /* …AND IT STANDS BACK UP. `UNDER_FIRE` seconds of frames and the slot is
     * the formation's again, which is what stops a line spending a battle
     * behind the first drum it met. */
    for (let i = 0; i < Math.ceil(Cmd.UNDER_FIRE * 30) + 2; i++) d._troops(1 / 30, {});
    const back = d.slotFor(e, new THREE.Vector3()).clone();
    assert(back.distanceTo(dry) < 1e-6,
      `${Cmd.UNDER_FIRE}s after the last hit the man is still ${back.distanceTo(dry).toFixed(1)} m off his mark`);
    return `leaned ${moved.toFixed(1)} m to the lee of a crate (bound ${bound.toFixed(1)} m) `
      + `and was back on his mark ${Cmd.UNDER_FIRE}s later`;
  });

  check('command: a squad shoots at what its leader is shooting at', () => {
    /**
     * "concentrate fire on what their leader is fighting." A PREFERENCE inside
     * the leash and not an override of it: five rifles that all kill the same
     * B2 in a second beat five rifles chipping five B2s for five, and a squad
     * that walked past the droid at its elbow to answer a call across the
     * field would be the opposite of concentration. Both bounds are measured.
     */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.order('line');
    d.deploy();
    const squad = d.roster.squads()[0];
    squad[0].award(30);                                  // make him unambiguously the leader
    assert(d.leaderOf(squad) === squad[0], 'the leader is not who this check thinks');
    const men = squad.filter((t) => t !== squad[0]).map((t) => t.body);
    for (const b of men) b.position.set(0, 0, 4);
    const reach = d.reachOf(men[0]);

    /* Two legal targets at comparable range: one a step nearer, one the
     * leader is on. */
    const near = { position: V(1, 0, 6), dead: false, team: 1, trooper: null };
    const his = { position: V(2.5, 0, 5.5), dead: false, team: 1, trooper: null };
    w.enemies.push(near, his);
    const cand = [near, his];
    const picks = () => { d._troops(1 / 30, {}); return men.map((b) => d.targetFor(b, cand)); };

    assert(picks().every((t) => t === near),
      'with no lead target the squad did not simply take the nearest — the baseline is wrong');

    squad[0].body.target = his;
    const onHim = picks().filter((t) => t === his).length;
    assert(onHim === men.length,
      `${onHim} of ${men.length} riflemen followed their leader onto the thing he is fighting`);

    /* …AND THE MAN IN YOUR GUARD WINS. `FOCUS_SLACK` is the clause that makes
     * this a preference: the leader's target may be half again as far as
     * whatever you would have shot at anyway, and no further. Still well
     * inside the rifle's own band, so it is the slack refusing it and not the
     * reach. */
     his.position.set(0, 0, 4 + reach * 0.9);
    assert(his.position.distanceTo(men[0].position) < reach,
      'this clause has put the leader\'s target outside the weapon band, so it proves nothing');
    assert(picks().every((t) => t === near),
      'a rifleman turned his back on something at two metres to follow the squad onto a body '
      + `${(his.position.distanceTo(men[0].position)).toFixed(0)} m away`);

    /* …AND THE LEADER HIMSELF IS NEVER FOLLOWING HIMSELF. His last pick must
     * not become his next one, or the one man whose job is to choose has a
     * target lock on. */
    assert(squad[0].body.cmdFocus === null,
      'the squad leader was handed his own target as a focus — that is a lock, not an order');

    /* AND A TARGET NEITHER BOUND ALLOWS IS REFUSED LIKE ANY OTHER. */
    his.position.set(0, 0, 400);
    assert(picks().every((t) => t === near),
      'the squad followed its leader onto a target outside its own leash');
    return `${onHim}/${men.length} concentrated on the leader's target at a comparable range; `
      + `refused at ${(reach * 0.9).toFixed(0)} m with something at 2 m, and refused past the leash`;
  });

  check('command: a squad that has mostly broken falls back together', () => {
    /**
     * "they should fall back when a position is lost." Breaking is a MAN's
     * decision and this file already had it; a position is a SQUAD's. The
     * steady men go back with the broken ones, because a squad that leaves its
     * two bravest riflemen standing on lost ground has not fallen back, it has
     * been destroyed in detail. `MORALE.ROUT` is the fraction.
     */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.order('front');                                   // a vanguard, well ahead of you
    d.deploy();
    d._troops(1 / 30, {});
    const squad = d.roster.squads()[0];
    for (const t of squad) { t.morale = 0.8; t.broken = false; }
    /* Every man exactly on his mark, so a steady one has nothing to walk to
     * and any `wish` at all is the withdrawal rather than the walk home. */
    for (const t of squad) {
      const at = d.slotFor(t.body, new THREE.Vector3());
      if (at) t.body.position.copy(at);
    }
    /* The one this check is about is the man FURTHEST forward: `steer`'s
     * fall-back only writes a direction past 5 m, which is the rule that stops
     * a rout being a shuffle. */
    const steady = squad.slice().sort((a, b) =>
      b.body.position.length() - a.body.position.length())[0];
    assert(steady.body.position.length() > 6,
      `the vanguard's furthest slot is ${steady.body.position.length().toFixed(1)} m out`);

    d._morale(1 / 30, d.commander);
    assert(!steady.rout, 'a squad at 0.80 morale is already routing');
    const held = steady.body;
    held.wish = null; held.target = null;
    d.steer(held, 1 / 30);
    assert(!held.wish, 'a steady man on his own mark was already walking somewhere');

    /* Break just over half of them and leave that one steady. Above REFUSE, so
     * a rally can reach them again at the end. */
    const n = squad.length, need = Math.floor(n * Cmd.MORALE.ROUT) + 1;
    const others = squad.filter((t) => t !== steady);
    assert(others.length >= need, `a squad of ${n} cannot be half broken and leave one steady`);
    for (let i = 0; i < need; i++) { others[i].morale = 0.15; others[i].broken = true; }
    d._morale(1 / 30, d.commander);
    assert(steady.rout, `${need} of ${n} broken did not rout the squad`);
    assert(!steady.broken, 'the man this check is about broke on his own');

    held.wish = null;
    d.steer(held, 1 / 30);
    assert(held.wish, 'the steady man in a routed squad was given no direction');
    const toward = held.wish.x * (me.position.x - held.position.x)
      + held.wish.z * (me.position.z - held.position.z);
    assert(toward > 0, 'the withdrawal went away from the commander rather than back to them');

    /* …AND IT RE-FORMS WITH NO EVENT. Derived from the same `broken` count, so
     * a rally is all it takes to put the squad back on its ground. */
    d.rallyNear(me.position, 500);
    d._morale(1 / 30, d.commander);
    assert(!steady.rout, 'a rallied squad is still routing');
    return `${need}/${n} broken → the whole squad withdrew toward the commander, and a rally re-formed it`;
  });

  check('command: the order door answers for every id the wheel can show', () => {
    /**
     * `ORDERS` is what the order wheel and the bindings registry should be
     * handed, and the property that makes that safe is that `order()` answers
     * for every id in it — HUD.js dispatches anything that is not the HOLD
     * toggle straight into `order(id)`, so an id on the wheel that the door
     * refuses is a slot that does nothing when you let go of the key.
     *
     * HOLD is the one that was broken and it was broken over the WIRE: a
     * joining commander's `hold()` sends `requestOrder('hold')`, the host
     * answers by calling this method, and this method tested `FORMATIONS`.
     */
    const { w, d } = dirFor();
    const me = forceful();
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    /* `ORDERS = { ...FORMATIONS, ...COMMAND_FORCE }`, so "ORDERS is a superset
     * of FORMATIONS" is true by construction and cannot fail for the reason it
     * used to give. The ONE thing that spread can do wrong is shadow: a Force
     * verb sharing an id with a formation silently replaces it, and the wheel
     * then shows a slot that casts instead of forming up. That is the claim. */
    const shadowed = Object.keys(Cmd.COMMAND_FORCE).filter((id) => id in Cmd.FORMATIONS);
    assert(!shadowed.length,
      `${shadowed.join(', ')} is both a formation and a Force verb — the spread that builds ORDERS `
      + 'drops the formation, so the wheel shows a slot that casts instead of forming up');
    const names = Object.values(Cmd.ORDERS).map((o) => o.name);
    assert(new Set(names).size === names.length, `two orders share a name: ${names.join(', ')}`);
    /* A key, where one is claimed, is claimed once — the wheel is not a reason
     * to stop caring about the keyboard. */
    const keys = Object.values(Cmd.ORDERS).map((o) => o.key).filter(Boolean);
    assert(new Set(keys).size === keys.length, `two orders want the same key: ${keys.join(', ')}`);

    for (const id of Cmd.ORDER_IDS) {
      me.force = 500;
      d.commander._castCd = {};
      assert(d.order(id) === true, `order('${id}') was refused — the wheel would show a dead slot`);
    }
    /* HOLD, both spellings, through the same door the wire uses. */
    d.commander.holding = false;
    assert(d.order('hold') === true && d.commander.holding === true, "order('hold') did not hold");
    assert(d.order('hold') === true && d.commander.holding === false, "order('hold') is not a toggle");
    d.commander.holding = true;
    assert(d.order('hold:off') === true && d.commander.holding === false, "order('hold:off') did not release");
    assert(d.order('nonsense') === false, 'the door accepted an id that is not an order');
    return `${Cmd.ORDER_IDS.length} orders (${Cmd.FORMATION_IDS.length} formations, `
      + `${Object.keys(Cmd.COMMAND_FORCE).length} Force verbs) all answered, plus hold and hold:off`;
  });

  check('command: the army answers the three things something outside it can ask for', () => {
    /**
     * `src/game/Stratagems.js` — the support calls entered as a WASD code —
     * reaches into this director by name for `rallyNear`, `reinforce` and
     * `reviveNear`, and guards on their absence. So the failure mode is a
     * stratagem that charges Force, plays its sound and does nothing at all,
     * which is invisible from either side. Asserted here because this is the
     * file that owns the roster, the purse and the gunship.
     *
     * `rallyNear` is also what the RALLY verb runs. One rally, two prices.
     */
    const { w, d } = dirFor();
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: TEAM.PARTY };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    for (const m of ['rallyNear', 'reinforce', 'reviveNear']) {
      assert(typeof d[m] === 'function', `CommandDirector.${m} is missing — Stratagems.js calls it`);
    }
    const t = d.roster.living[0];
    t.morale = 0.14; t.broken = true;
    assert(d.rallyNear(me.position, 22) >= 6, 'rallyNear reached nobody');
    assert(!t.broken, 'rallyNear does not do what the RALLY verb does');

    /* REINFORCEMENTS ARE PAID FOR. That is the note's whole premise — a loss is
     * permanent and a replacement is bought — so a support call spends the
     * same purse the muster screen does, and refuses when it is empty. */
    const strength = d.roster.strength;
    d.roster.points = 0;
    assert(d.reinforce(4, { byShip: false }) === 0, 'four free troopers arrived on an empty purse');
    assert(d.roster.strength === strength, 'the roster grew anyway');
    d.roster.points = 200;
    const came = d.reinforce(4, { byShip: false });
    assert(came === 4, `${came} of 4 reinforcements arrived with 200 points in hand`);
    assert(d.roster.points < 200, 'they were free');
    assert(d.roster.living.slice(-1)[0].body, 'a reinforcement was enlisted and never given a body');

    /* THE WOUNDED BACK UP — half of maximum, not a full heal. */
    const hurt = d.roster.living[1].body;
    hurt.hp = 1; hurt.position.set(0, 0, 3);
    const n = d.reviveNear(me.position, 9);
    assert(n > 0 && hurt.hp > 1, 'reviveNear left the wounded on the floor');
    assert(hurt.hp <= hurt.maxHp * 0.5 + 1e-6,
      `reviveNear healed to ${(hurt.hp / hurt.maxHp * 100).toFixed(0)}% — a support pod undid the firefight`);
    return `rallyNear ${d.roster.strength} standing, reinforce refused an empty purse and landed 4 on a full one, `
      + `reviveNear put a 1 hp man back to ${(hurt.hp / hurt.maxHp * 100).toFixed(0)}%`;
  });

  /**
   * ── DELEGATION, AND THE THREE THINGS IT HAS TO BE ────────────────────
   *
   * `order(id, cmdr, squad)` has been able to give one squad its own formation
   * since the per-squad slice landed. What it could not do was give it its own
   * PLACE: `c._planted` is one frame per commander, so two squads told to hold
   * two things were both planted on whichever body the general was standing in
   * at the time, and a squad ordered to a gate re-formed around the player the
   * moment he walked off. Three squads, three orders, one line.
   *
   * PLAN.md §6 puts this ahead of density — "without this the quorum breaks the
   * moment density arrives" — so these are the three sentences that have to be
   * true for the word to mean anything, and each is a separate check because
   * each can become false on its own:
   *
   *   1. TWO SQUADS CAN HOLD TWO PLACES. The plants are distinct and neither is
   *      the general's.
   *   2. THE GENERAL CAN WALK AWAY. Two hundred metres, and the squad is still
   *      standing on its ground rather than following him.
   *   3. THE QUORUM COUNTS THEM. A man where he was told to be is with his
   *      line, or the game punishes the player for using the interface it just
   *      gave him.
   */
  check('squads: two squads can be given two pieces of ground, and neither is yours', () => {
    const { w, d } = delegated();
    const c = d.commander;
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, `the deployed army made ${squads.length} squads — nothing to delegate`);
    /* Move the squads apart BEFORE ordering them, because the ground each is
     * given is the ground its own men are standing on — see `_squadFrame`. Left
     * stacked at deploy, two distinct plants would be two distinct names for one
     * spot and this check would pass on nothing. */
    for (const t of squads[0]) if (t.body) t.body.position.set(-60, 0, 0);
    for (const t of squads[1]) if (t.body) t.body.position.set(60, 0, 0);
    w.player.position.set(0, 0, 0);

    d.order('cover', c, 0);
    d.order('cover', c, 1);
    const a = c.squadPlanted?.get('0'), b = c.squadPlanted?.get('1');
    assert(a && b, `only ${[a, b].filter(Boolean).length} of 2 squads were given ground`);
    const apart = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    assert(apart > 80,
      `the two squads were planted ${apart.toFixed(1)} m apart — they were told to hold two `
      + 'different things and were both put in one place, which is the defect this exists to stop');
    const fromPlayer = Math.hypot(a.pos.x, a.pos.z);
    assert(fromPlayer > 40,
      `1st squad's ground is ${fromPlayer.toFixed(1)} m from the general — it was planted on him `
      + 'rather than on itself, so the order named a squad and moved the army');
    return `1st at ${a.pos.x.toFixed(0)},${a.pos.z.toFixed(0)} · 2nd at ${b.pos.x.toFixed(0)},`
      + `${b.pos.z.toFixed(0)} — ${apart.toFixed(0)} m apart, ${fromPlayer.toFixed(0)} m off the general`;
  });

  check('squads: …and the general can walk away from the ground he gave them', () => {
    const { w, d } = delegated();
    const c = d.commander;
    const squads = d.squadsOf(c);
    for (const t of squads[0]) if (t.body) t.body.position.set(-60, 0, 0);
    w.player.position.set(0, 0, 0);
    d.order('cover', c, 0);

    const one = squads[0].find((t) => t.body)?.body;
    const other = squads[1].find((t) => t.body)?.body;
    assert(one && other, 'no bodies to measure');
    const slot = (e) => d.slotFor(e, new THREE.Vector3()).clone();
    const sprint = (z) => { w.player.position.set(0, 0, z); c._paceAnchor = null; c._heldYaw = 0; };

    const before = slot(one);
    sprint(200);                        // the general runs two hundred metres
    const drift = before.distanceTo(slot(one));
    assert(drift < 5,
      `the general walked 200 m and 1st squad's slot moved ${drift.toFixed(1)} m with him — the `
      + 'standing order is not standing, so "hold this and I will go" is not a sentence this game '
      + 'can say');

    /* THE CONTROL, and without it the assertion above proves nothing: a squad
     * with no order of its own must still come when the general moves. */
    sprint(0);
    const u0 = slot(other);
    sprint(200);
    const follow = u0.distanceTo(slot(other));
    assert(follow > 100,
      `an UNDELEGATED squad's slot moved only ${follow.toFixed(1)} m when the general moved 200 — `
      + 'the control arm is broken, so the first assertion proves nothing');
    return `the ordered squad drifted ${drift.toFixed(1)} m over a 200 m sprint; the squad with no `
      + `order of its own came ${follow.toFixed(0)} m`;
  });

  check('squads: a man standing where he was told to stand is with his line', () => {
    const { w, d } = delegated();
    const c = d.commander;
    d.lineAdvances = true;
    const squads = d.squadsOf(c);
    w.player.position.set(0, 0, 0);
    for (const s of squads) for (const t of s) if (t.body) t.body.position.set(0, 0, 2);
    assert(d.lineGathered(c), 'the whole army standing on the general did not read as gathered');

    /* Two squads are sent out — 1st to a gate 120 m east, 2nd to a ridge 120 m
     * west — and only 1ST is given an order to be there. Two, because the
     * quorum is HALF the living and one squad of a three-squad army does not
     * move it; the second squad is what makes the unordered reading fall, and
     * it stays unordered so that what comes back is the ordered squad alone.
     *
     * Under the old rule this is most of the army "scattered" and the ground
     * stops being creditable — the game punishing the player for delegating. */
    for (const t of squads[0]) if (t.body) t.body.position.set(120, 0, 0);
    for (const t of squads[1]) if (t.body) t.body.position.set(-120, 0, 0);
    const beforeOrder = d.lineGathered(c);
    d.order('cover', c, 0);
    const afterOrder = d.lineGathered(c);
    assert(!beforeOrder,
      'most of the army 120 m away with NO order read as gathered — the quorum is not measuring '
      + 'anything and the assertion below cannot mean anything');
    assert(afterOrder,
      'a squad standing exactly on the ground it was ordered to hold still did not count toward '
      + 'the quorum — so using delegation costs you the ability to take ground, and the mode '
      + 'teaches the player not to use it');
    return `${squads[0].length + squads[1].length} of ${d.roster.living.length} men sent 120 m out `
      + `and the line is down; the ${squads[0].length} of them ORDERED to that ground bring it back up`;
  });

  check('squads: a squad is a thing that exists between frames, and one man can leave it', () => {
    /*
     * "Are we able to separately order squads? Sometimes it'll say 2 squads but
     * they get ordered as one… I should be able to order separate squads or all
     * squads at once depending on my choosing." And: "you should be able to
     * take an npc out of their squad and individually assign them things… but
     * you should be able to reverse it and put them back in with their squads."
     *
     * Neither was possible, and it was one cause: `squads()` was
     * `live.slice(i, i + size)` — squads derived from where a man happened to
     * sit in the living list. That survives permadeath very gracefully and
     * makes a squad un-nameable, because "2nd Squad" did not exist from one
     * frame to the next: a casualty anywhere re-dealt every man into a
     * different squad. `formation` lived on the COMMANDER for the same reason —
     * there was nothing else stable to hang it on.
     *
     * What is asserted is the whole contract: the assignment is stable, an
     * order can be aimed at one squad, an army-wide order overrides the lot,
     * casualties shrink a squad instead of re-dealing it, a reinforcement fills
     * the thinnest squad rather than always opening a new one, and a detached
     * man is his own group who goes back where he came from.
     */
    const R = new Cmd.CommandRoster(Cmd.ARMIES[Cmd.ARMY_IDS[0]]);
    for (let i = 0; i < 12; i++) R.enlist('trooper');
    /**
     * THE SIZES OF THE SQUADS THAT HAVE MEN IN THEM.
     *
     * `squads()` is indexed by the squad NUMBER and padded to `SQUAD_SLOTS`, so
     * a wiped squad is an empty entry and a detached man's index can never be
     * a squad's — see the note there and `squads.mjs`. Its raw length is a
     * count of SLOTS and never was a count of squads; what this check is about
     * is how the men are dealt, so the empties are dropped before the shape is
     * read. A squad that empties still shows as a shrinking group below,
     * because it has men in it right up until it does not.
     */
    const shape = () => R.squads().map((s) => s.length).filter((n) => n).join('+');
    assert(shape() === '5+5+2', `12 men dealt to ${shape()}, expected 5+5+2`);

    const ids = R.living.map((t) => t.squad);
    assert(ids.every((v) => v != null), 'a living man has no squad assignment');
    /* STABLE ACROSS CALLS is the whole point — the old slice was stable too
     * until somebody died, so this has to be measured across a death. */
    const before = new Map(R.living.map((t) => [t.id, t.squad]));
    for (const t of R.all.slice(0, 3)) t.alive = false;
    assert(shape() === '2+5+2', `after 3 casualties in 1st Squad the shape is ${shape()}, expected 2+5+2`);
    for (const t of R.living) {
      assert(before.get(t.id) === t.squad,
        `${t.designation} was moved from squad ${before.get(t.id)} to ${t.squad} by somebody ELSE dying`);
    }

    const fresh = R.enlist('trooper');
    R.assignSquads();
    assert(fresh.squad === 0,
      `a reinforcement opened squad ${fresh.squad} instead of filling the 2-man 1st Squad`);

    const victim = R.living.find((t) => t.squad === 1);
    const was = victim.squad;
    assert(R.detach(victim, true), 'detach refused a living trooper');
    const solo = R.squads().filter((s) => s.length === 1 && s[0] === victim);
    assert(solo.length === 1, 'a detached man is not his own group in squads()');
    assert(R.squads().some((s) => s.includes(victim) && s.length === 1),
      'the detached man is still being grouped with his old squad');
    assert(R.detach(victim, false), 'putting him back refused');
    assert(victim.squad === was,
      `he came back to squad ${victim.squad} instead of the ${was} he left`);
    assert(!R.squads().some((s) => s.length === 1 && s[0] === victim),
      'he is still his own group after being sent back');
    return `12 → ${'5+5+2'}, 3 dead → 2+5+2 with every survivor's number kept, `
      + `a reinforcement into 1st, and one man out of 2nd and back`;
  });

  /* ── the branching route (PLAN.md §4.6) ───────────────────────────── */

  check('command: the route forks, the run keeps its length, and the fork says nothing about the wave', async () => {
    /**
     * PLAN.md §4.6: "A branching route over the five Command areas that already
     * exist, with partial information: you see the ground, the weather and the
     * garrison weight, not the contents."
     *
     * §7's guardrail is that a check has to DEMONSTRATE THE DECISION CHANGING,
     * so this is an A/B: one seed, two directors, the same plan, and the only
     * difference between them is which road was taken at the one boundary that
     * has two. Everything asserted below is a difference between those two runs
     * or a thing that is identical across them, because a fork whose two roads
     * produce the same run is not a fork and a fork that changes the LENGTH of
     * the run is a broken promise on the deploy card.
     *
     *   DIFFERENT      the ground, the muster it pays, the garrison band, the
     *                  rung the shelf is gated on, and the total reinforcement
     *                  points the crossing hands out.
     *   THE SAME       the number of engagements, the first ground, the last
     *                  ground, and that the route only ever goes forwards.
     *   NOT THERE      the contents. No budget, no heavy share, no archetype —
     *                  and the proof is that the fork does not move when the
     *                  wave's inputs do.
     */
    const { rollSession, planStages, SESSION_PLANS } = await import('../../src/game/Session.js');

    /* THE SEED IS FOUND, NOT TYPED. A fork needs slack and only the Push has
     * any (see `routeChoices`), so the check asks the roll which seeds are
     * Pushes rather than hard-coding one that happens to be — the day the
     * weights move, this still finds a Push instead of silently testing a
     * Grind that has no fork in it and passing for the wrong reason. */
    let seed = 0;
    while (seed < 512 && rollSession(seed).id !== 'push') seed++;
    assert(rollSession(seed).id === 'push', `no seed under 512 rolls a Push`);

    /**
     * One crossing, driven to its end on the stub world, taking road `pick` at
     * every boundary that offers one.
     *
     * `pick` is an INDEX into the offer's own `route` and not an area id, so
     * the two drives below differ by one integer and nothing else — a check
     * that named the two grounds would be a check that stops meaning anything
     * the day `AREAS` is re-tuned.
     */
    const cross = (pick) => {
      const w = cmdWorld();
      w.runSeed = seed;
      /* `_endCampaign` reaches for the three things a real World has at the end
       * of a run. Stubbed here rather than stopping the drive one area short,
       * because the last clear is the one that logs the last engagement. */
      w._announceBattle = () => {};
      w.runStats = (o) => o;
      w.onGameOver = () => {};
      const { d } = dirFor({ world: w });
      const forks = [];
      d.onMuster = (o) => {
        if ((o.route || []).length > 1) {
          forks.push(o.route);
          const want = o.route[Math.min(pick, o.route.length - 1)];
          /* `takeRoute` reports whether the route MOVED, so asking for the road
           * you are already on is honestly false rather than a silent yes —
           * which is also the assertion that "choose nothing" and "choose the
           * default" are the same run. */
          if (want.taken) assert(!d.takeRoute(want.id), 'taking the road already taken moved the route');
          else assert(d.takeRoute(want.id), `the director refused the road to ${want.name}`);
          assert(d.stages[d.areaIndex].id === want.id,
            `asked for ${want.name} and the route walks onto ${d.stages[d.areaIndex].name}`);
          assert(d.musterOffer().route.find((r) => r.id === want.id).taken,
            'the re-read offer does not mark the road that was taken');
        }
        /* The same two calls the no-screen path makes, so the ONLY difference
         * between the two drives is the road. */
        d.autoMuster();
        d.closeMuster();
      };
      /* One wave paid per area, on the LAST wave of it, and the run's own
       * counter keeps climbing across the boundaries: `WaveDirector.payWave`
       * pays a wave number once, so a driver that restarted the count at every
       * area would silently stop paying the moment two areas were the same
       * length — which is exactly what a branch that swaps a 4-wave ground for
       * a 5-wave one makes happen. */
      let wave = 0;
      for (let guard = 0; guard < 32 && !d.done; guard++) {
        const A = d.area;
        d.areaWaves = A.waves - 1;
        d.wave = (wave += A.waves);
        if (!d.payWave(wave)) break;
      }
      assert(d.done, `the crossing never ended on road ${pick}`);
      return { d, forks };
    };

    const A = cross(0), B = cross(1);
    assert(A.d.plan.id === 'push' && B.d.plan.id === 'push',
      `seed ${seed} built a ${A.d.plan.id}, not the Push it rolls`);

    /* ── ONE FORK, AND IT IS WHERE THE ARITHMETIC SAYS IT IS ───────────── */
    assert(A.forks.length === 1 && B.forks.length === 1,
      `a Push offered ${A.forks.length}/${B.forks.length} forks; its three stages over `
      + `${Cmd.AREAS.length} grounds leave exactly one slot free`);
    const [one, two] = A.forks[0];
    assert(one.taken && !two.taken,
      'the first candidate is not the road the run is already on — with no screen wired '
      + 'the director must take the ground `planStages` dealt');

    /* ── THE DECISION CHANGED THE RUN ──────────────────────────────────── */
    const ground = (d) => d.stages.map((st) => st.name);
    assert(ground(A.d).join() !== ground(B.d).join(),
      `both roads crossed ${ground(A.d).join(' → ')} — the fork changed nothing`);
    assert(A.d.stages[1] !== B.d.stages[1],
      'the two roads walked onto the same ground');
    assert(A.d.stages[1].muster !== B.d.stages[1].muster,
      `both roads pay ${A.d.stages[1].muster} reinforcement points — the fork trades no currency`);
    assert(Cmd.garrisonBand(A.d.stages[1]) !== Cmd.garrisonBand(B.d.stages[1]),
      `both roads read "${Cmd.garrisonBand(A.d.stages[1])}" — a band that is the same on both `
      + 'candidates changes no decision and should not be on the card');
    /* …AND IT REACHED THE PURSE, which is the consequence a player actually
     * feels. Off the ledger both runs wrote, not off the table they read. */
    const paid = (r) => r.d.stages.reduce((n, st) => n + st.muster, 0);
    assert(paid(A) !== paid(B),
      `both crossings paid out ${paid(A)} points in total`);
    /* …and the shelf: the heavier road stands on a higher rung one engagement
     * earlier, which is what `areaRung` gates `unlockAt` on. */
    const rungAt1 = (r) => Cmd.AREAS.indexOf(r.d.stages[1]) + 1;
    assert(rungAt1(A) !== rungAt1(B),
      `both roads stand on rung ${rungAt1(A)} for their second engagement`);

    /* ── AND IT DID NOT CHANGE THE PROMISE ─────────────────────────────── */
    const engagements = (r) => r.d.log.filter((e) => e.t === 'area').length;
    assert(engagements(A) === engagements(B) && engagements(A) === A.d.plan.engagements,
      `${engagements(A)} and ${engagements(B)} engagements were fought of a Push's `
      + `${A.d.plan.engagements} — the deploy card printed a duration`);
    for (const r of [A, B]) {
      assert(r.d.stages.length === r.d.plan.engagements, 'the route changed length');
      assert(r.d.stages[0] === Cmd.AREAS[0], 'a road did not start at the landing zone');
      assert(r.d.stages[r.d.stages.length - 1] === Cmd.AREAS[Cmd.AREAS.length - 1],
        'a road did not end on the last ground');
      for (let i = 1; i < r.d.stages.length; i++) {
        assert(Cmd.AREAS.indexOf(r.d.stages[i]) > Cmd.AREAS.indexOf(r.d.stages[i - 1]),
          `the route doubles back at stage ${i + 1} — the shelf would lose a rung between areas`);
      }
    }

    /* ── THE FORK CARRIES THE GROUND AND NOT THE CONTENTS ──────────────── */
    const KEYS = ['brief', 'garrison', 'id', 'muster', 'name', 'rung', 'taken', 'waves'];
    for (const cand of A.forks[0]) {
      assert(Object.keys(cand).sort().join() === KEYS.join(),
        `a candidate carries {${Object.keys(cand).sort().join()}} and the fork may carry {${KEYS.join()}}`);
      /* Every number on it is a COUNT — a rung, a wave count, a price. The two
       * dials that decide what the wave is made of are fractions, so this one
       * assertion excludes both of them by their own shape rather than by
       * naming them. */
      const nums = Object.values(cand).filter((v) => typeof v === 'number');
      assert(nums.length && nums.every(Number.isInteger),
        `${cand.name} carries a fractional number — budget and heavy are the only `
        + 'fractions in AREAS and neither of them is the player’s to see');
      for (const area of Cmd.AREAS) {
        assert(!nums.includes(area.budget) && !nums.includes(area.heavy),
          `${cand.name} is carrying ${area.name}'s wave dials`);
      }
      /* The prose is the ground's own, so no third description of a place can
       * drift from the deploy card's and the muster header's. */
      const src = Cmd.AREAS.find((a) => a.id === cand.id);
      assert(src && cand.name === src.name && cand.brief === src.brief,
        `${cand.id} is described in words that are not AREAS' own`);
      assert(Cmd.GARRISON_BANDS.includes(cand.garrison),
        `"${cand.garrison}" is not one of the declared bands`);
    }

    /**
     * …AND THE PROOF THAT IT IS ABOUT THE GROUND RATHER THAN THE WAVE: buy a
     * body, which moves every input the composer has — `allyScale` is per
     * living muster point and `budgetFor` multiplies by it — and re-read the
     * offer. A fork that shifted by so much as a word would be a fork that had
     * been told what is coming.
     */
    const w2 = cmdWorld();
    w2.runSeed = seed;
    const { d: probe } = dirFor({ world: w2 });
    probe.onMuster = () => {};
    probe.areaWaves = probe.area.waves - 1;
    probe.wave = probe.area.waves;
    assert(probe.payWave(probe.area.waves), 'the probe never held its first area');
    assert(probe.mustering, 'the probe is not sitting on an open muster');
    const before = JSON.stringify(probe.musterOffer().route);
    const scaleBefore = probe.allyScale();
    probe.roster.points += 999;
    assert(probe.recruit('heavy') || probe.recruit('trooper'), 'the probe could not buy a body');
    assert(probe.allyScale() !== scaleBefore, 'buying a body did not move the wave’s own input');
    assert(JSON.stringify(probe.musterOffer().route) === before,
      'the fork moved when the army did — it is reading the wave, not the ground');

    /* ── AND THE PLANS THAT HAVE NO SLACK HAVE NO FORK ─────────────────── */
    const census = [];
    for (const plan of SESSION_PLANS) {
      const w3 = cmdWorld();
      const { d } = dirFor({ world: w3 });
      d.plan = plan;
      d.stages = planStages(plan, Cmd.AREAS);
      let n = 0;
      for (let i = 0; i < d.stages.length; i++) { d.areaIndex = i; if (d.routeChoices().length) n++; }
      /**
       * TWO THINGS HAVE TO BE TRUE OF ANY LADDER, and they are stated as
       * properties rather than as the numbers this one happens to produce:
       *
       *   NO SLACK, NO FORK. A route with as many stages as there are grounds
       *     has every slot spoken for — that is the Grind, and it is correct
       *     rather than a gap: its own blurb is "the whole crossing".
       *   NO INTERIOR SLOT, NO FORK. The first stage and the last are pinned,
       *     so a plan of two stages is decided before it starts — that is the
       *     Raid. A fork can only ever appear at one of the `n - 2` slots
       *     between the ends, which is also the ceiling on how many there are.
       */
      const slack = Cmd.AREAS.length - plan.engagements;
      const interior = Math.max(0, plan.engagements - 2);
      if (!slack || !interior) {
        assert(n === 0,
          `a ${plan.id} offers ${n} forks with ${slack} grounds spare and ${interior} slots that are not ends`);
      } else {
        assert(n >= 1 && n <= interior,
          `a ${plan.id} offers ${n} forks over ${interior} interior slots with ${slack} grounds spare`);
      }
      census.push(`${plan.id} ${n}`);
    }

    /* ── AND WITH NO SCREEN THE ROUTE IS THE ONE planStages DEALT ──────── */
    const w4 = cmdWorld();
    w4.runSeed = seed;
    w4._announceBattle = () => {}; w4.runStats = (o) => o; w4.onGameOver = () => {};
    const { d: quiet } = dirFor({ world: w4 });
    const planned = planStages(quiet.plan, Cmd.AREAS);
    let qw = 0;
    for (let guard = 0; guard < 32 && !quiet.done; guard++) {
      const st = quiet.area;
      quiet.areaWaves = st.waves - 1;
      quiet.wave = (qw += st.waves);
      if (!quiet.payWave(qw)) break;
    }
    assert(quiet.stages.length === planned.length && quiet.stages.every((st, i) => st === planned[i]),
      'a crossing with no muster screen wired left the route `planStages` dealt');

    return `seed ${seed} rolls a Push: one fork (${census.join(' · ')}), `
      + `${one.name} ${one.muster}pts/${one.waves}w "${one.garrison}" against `
      + `${two.name} ${two.muster}pts/${two.waves}w "${two.garrison}"; `
      + `${engagements(A)} engagements either way, ${paid(A)} vs ${paid(B)} points paid out`;
  });

}

/* A file read, kept out of the check body so the import list stays honest. */
import { readFileSync } from 'node:fs';
function require$(p) { return readFileSync(p, 'utf8'); }
