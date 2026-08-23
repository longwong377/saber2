/**
 * BATTLEFRONT BORZ — the order you can check.
 *
 * `src/game/FireMission.js` is PLAN.md §1's "the thesis, as one keypress". Its
 * own header carries the design; this file holds the properties that make it a
 * decision rather than a prompt, and PLAN.md's guardrail #2 decides which ones
 * those are: "every element must change a decision, and its check must
 * demonstrate the decision changing" — not that the feature exists.
 *
 * ── THE THREE THAT MATTER ────────────────────────────────────────────────
 *
 * THE GAME NEVER SAYS SO. The counts are unreadable until the reading is
 * finished, and that is asserted against a field that HAS friendlies standing
 * in the mark. If a panel could learn it for free there is nothing to check and
 * the section is a warning with extra steps.
 *
 * CHECKING IS WHAT PUTS YOUR MEN IN IT. The reading needs eyes inside
 * `READ_REACH` of a mark laid 70–140 m beyond your line, and an un-delegated
 * squad solves its formation on your body — so the same order, walked to twice
 * on the same ground, catches the line in one arm and not in the other, and the
 * only difference is whether the player planted them first. That is the weld to
 * the keystone and it is measured on a real `CommandDirector` with real bodies,
 * because it is a fact about a world stepping and not about arithmetic.
 *
 * OBEYING IS FASTER AND REWARDED. The prize decays across the window, so the
 * twelve seconds cost war support whether or not the reading finds anything,
 * and refusing costs the prize and High Command's patience.
 *
 * ── AND THE SHAPE OF THE FIXTURE ─────────────────────────────────────────
 *
 * Stubs where the question is arithmetic over a rule table (who is inside an
 * ellipse, what a clock does, what a prize is worth), and real objects for the
 * two questions that are about a world stepping: the weld above, and whether
 * the shells go through the door every other blast goes through. Same split
 * `objectives.mjs` argues for, and for the same reason.
 */

import * as THREE from 'three';
import {
  FireMission, FireMissionDirector, gridName,
  WINDOW, READ_SECONDS, SENSE_RATE, READ_REACH, ELLIPSE_A, ELLIPSE_B,
  PRIZE, PRIZE_FLOOR, TRUST_LOSS, TRUST_MIN, SHELLS, SHELL_DAMAGE,
  DEPTH_NEAR, DEPTH_FAR, HIGH_COMMAND, STANDING, FIRED, LAPSED,
} from '../../src/game/FireMission.js';
import { MODES } from '../../src/game/Waves.js';
import { killerName } from '../../src/game/Command.js';
import { interludeBeats } from '../../src/game/Session.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

let _n = 0;
/** A body on `team` standing at (x, z), with a name if it is one of yours. */
function body(team, x, z, name = null) {
  return {
    id: 'b' + (++_n), team, dead: false, position: V(x, 0, z),
    trooper: name ? { name } : null,
  };
}

/**
 * A world with exactly the fields the director reads, and a `blast` that
 * records rather than resolves. The two checks that need a real blast build a
 * real Player.
 */
function stubWorld(opts = {}) {
  const shells = [];
  const w = {
    scene: null, time: 0,
    terrain: { height: () => 0 },
    enemies: [], notes: [], shells,
    notify(a, b) { this.notes.push([a, b]); },
    support: { got: 0, credit(n) { this.got += n; return n; } },
    command: { log: [] },
    player: {
      dead: false, position: V(opts.px ?? 0, 0, opts.pz ?? 0), senseActive: false,
      stratagems: { blast(ctx, at, r, f, d, o) { shells.push({ at: at.clone(), r, f, d, o }); } },
    },
  };
  return w;
}

/** Step a director for `seconds` at 1/30. */
function drive(d, seconds, each = null) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) { d.update(1 / 30, {}); each?.(i); }
}

/** An order laid at the origin, pointing up +z, with `told` taken honestly. */
function laid(d, w, centre = V(0, 0, 100)) {
  return d.issue({ centre, bearing: 0 });
}

export async function run({ check, assert }) {

  check('fire mission: the mode declares it, and only the mode whose quorum makes it cost anything', () => {
    assert(MODES.theline?.fireMissions === true,
      'The Line does not declare fireMissions — PLAN.md §1 puts the order you can check in the '
      + 'mode whose advance rule is what makes checking cost something');
    const others = Object.entries(MODES).filter(([id, M]) => id !== 'theline' && M.fireMissions);
    assert(!others.length,
      `${others.map(([id]) => id).join(', ')} also declares fireMissions — in a mode with no `
      + 'quorum, walking out to read a mark costs nothing, so the order would be free to check '
      + 'and the decision evaporates');
    return 'theline only';
  });

  check('fire mission: the estimate is honest, and it is never revised', () => {
    const w = stubWorld();
    const d = new FireMissionDirector(w, { myTeam: 0 });
    /* Nine of theirs standing on the ground when the order is cut. */
    for (let i = 0; i < 9; i++) w.enemies.push(body(1, (i % 3) * 4 - 4, 100 + Math.floor(i / 3) * 4));
    const m = laid(d, w);
    assert(m, 'no order was cut over nine hostiles');
    assert(m.told === 9, `the card says ${m.told} where nine were standing — the estimate is not honest`);
    /* Now the battle moves: they fall back and four of yours walk in. */
    for (const e of w.enemies) e.position.z += 200;
    for (let i = 0; i < 4; i++) w.enemies.push(body(0, i * 3 - 4, 100, `CT-${1100 + i}`));
    drive(d, 5);
    assert(m.told === 9,
      `the card was revised to ${m.told} — the whole mechanic is that the estimate is a snapshot `
      + 'and the battle moves under it');
    const r = m.readout();
    assert(r.hostiles === null && r.friendlies === null,
      `an unread order published hostiles=${r.hostiles} friendlies=${r.friendlies} — "sometimes `
      + 'your own men are in it and the game never says so" is a property of this object');
    return `told 9, four of yours walked in, card still says ${m.told}, readout still says nothing`;
  });

  check('fire mission: the reading needs eyes on the ground and costs twelve seconds', () => {
    const far = stubWorld({ pz: 100 + READ_REACH + 12 });
    const dFar = new FireMissionDirector(far, { myTeam: 0 });
    const mFar = laid(dFar, far);
    drive(dFar, READ_SECONDS * 1.5);
    assert(mFar.read === 0,
      `a player ${READ_REACH + 12} m from the mark read it to ${(mFar.read * 100).toFixed(0)}% — `
      + 'the reading is what costs you leaving your line, so it cannot run from where you are');

    const near = stubWorld({ pz: 100 + READ_REACH - 5 });
    const dNear = new FireMissionDirector(near, { myTeam: 0 });
    const mNear = laid(dNear, near);
    drive(dNear, READ_SECONDS - 1);
    assert(!mNear.verified,
      `the mark read out after ${READ_SECONDS - 1}s against a ${READ_SECONDS}s reading`);
    drive(dNear, 1.2);
    assert(mNear.verified, `${READ_SECONDS}s inside the reach did not finish the reading`);

    /* …and the Force is the tool for it. */
    const sensed = stubWorld({ pz: 100 + 10 });
    sensed.player.senseActive = true;
    const dS = new FireMissionDirector(sensed, { myTeam: 0 });
    const mS = laid(dS, sensed);
    drive(dS, READ_SECONDS / SENSE_RATE - 0.5);
    assert(!mS.verified, 'Force sense read the mark faster than SENSE_RATE');
    drive(dS, 0.8);
    assert(mS.verified,
      `Force sense did not finish the reading in ${(READ_SECONDS / SENSE_RATE).toFixed(1)}s — the `
      + 'one job the design gives the power');
    return `outside ${READ_REACH} m: nothing · inside: ${READ_SECONDS}s on foot, `
      + `${(READ_SECONDS / SENSE_RATE).toFixed(1)}s with the Force`;
  });

  check('fire mission: the reading is the only thing that says your men are in it', () => {
    const w = stubWorld({ pz: 100 });
    const d = new FireMissionDirector(w, { myTeam: 0 });
    for (let i = 0; i < 5; i++) w.enemies.push(body(1, 8, 108 + i));
    const m = laid(d, w);
    /* Three of yours walk into the mark AFTER the order is cut. */
    for (let i = 0; i < 3; i++) w.enemies.push(body(0, i * 2 - 2, 96, `CT-${1200 + i}`));
    drive(d, 1);
    assert(m.readout().friendlies === null, 'an unread mark published a friendly count');
    drive(d, READ_SECONDS + 1);
    const r = m.readout();
    assert(r.verified, 'the reading did not finish with the player standing on the mark');
    assert(r.friendlies === 3,
      `the reading found ${r.friendlies} of yours where three are standing inside the ellipse`);
    assert(r.names.length === 3 && r.names[0].startsWith('CT-'),
      `the reading named ${JSON.stringify(r.names)} — a count with no names is a number, and the `
      + 'report is supposed to be about men');
    assert(r.hostiles === 5, `the reading found ${r.hostiles} hostiles against five standing in it`);
    return `unread: null · read: ${r.hostiles} hostiles, ${r.friendlies} of yours (${r.names.join(', ')})`;
  });

  check('fire mission: obeying is faster and rewarded, and refusing costs patience', () => {
    const now = stubWorld();
    const dNow = new FireMissionDirector(now, { myTeam: 0 });
    const mNow = laid(dNow, now);
    dNow.authorise({});
    const early = now.support.got;
    assert(mNow.state === FIRED, 'authorising did not fire the order');
    assert(Math.abs(early - PRIZE) < 0.01, `an immediate yes paid ${early.toFixed(1)} of ${PRIZE}`);

    const late = stubWorld();
    const dLate = new FireMissionDirector(late, { myTeam: 0 });
    laid(dLate, late);
    drive(dLate, READ_SECONDS);
    dLate.authorise({});
    const checked = late.support.got;
    assert(checked < early,
      `a yes after the ${READ_SECONDS}s reading paid ${checked.toFixed(1)} against ${early.toFixed(1)} `
      + 'for an immediate one — if checking is free the design has no cost in it');
    assert(checked > PRIZE * PRIZE_FLOOR * 0.99,
      `a checked yes paid ${checked.toFixed(1)}, under the ${(PRIZE * PRIZE_FLOOR).toFixed(1)} floor`);

    /* And the window closing unanswered. */
    const gone = stubWorld();
    const dGone = new FireMissionDirector(gone, { myTeam: 0 });
    const mGone = laid(dGone, gone);
    drive(dGone, WINDOW + 1);
    assert(mGone.state === LAPSED, `an unanswered order is ${mGone.state} after the window`);
    assert(gone.support.got === 0, `letting the window close paid ${gone.support.got} support`);
    assert(dGone.trust < 1 - TRUST_LOSS + 1e-6,
      `one refusal left patience at ${dGone.trust.toFixed(2)}`);
    /* Two refusals and the next order is worth about half the first. */
    const m2 = dGone.issue({ centre: V(0, 0, 100), bearing: 0 });
    assert(m2, 'no second order after a refusal');
    drive(dGone, WINDOW + 1);
    const m3 = dGone.issue({ centre: V(0, 0, 100), bearing: 0 });
    dGone.authorise({});
    const afterTwo = gone.support.got;
    assert(afterTwo < early * 0.75,
      `after two refusals an immediate yes still paid ${afterTwo.toFixed(1)} of ${early.toFixed(1)} `
      + '— the fleet is supposed to stop backing a general who never answers');
    assert(dGone.trust >= TRUST_MIN, 'patience fell through its own floor');
    void m3;
    return `now +${early.toFixed(0)} · after the reading +${checked.toFixed(0)} · refused 0 `
      + `(patience ${dGone.trust.toFixed(2)}) · two refusals then now +${afterTwo.toFixed(0)}`;
  });

  check('fire mission: the shells sweep the whole ellipse, and the mark is where they land', () => {
    const w = stubWorld();
    const d = new FireMissionDirector(w, { myTeam: 0 });
    const m = laid(d, w);
    d.authorise({});
    drive(d, 6);
    assert(w.shells.length === SHELLS,
      `${w.shells.length} shells landed against ${SHELLS} in the pattern`);
    const out = w.shells.filter((s) => !m.inside(s.at));
    assert(!out.length,
      `${out.length} of ${SHELLS} shells landed outside the ellipse that was drawn on the ground — `
      + 'the mark would be a lie about where it is safe to stand');
    /* And they are spread over it rather than piled in the middle: the mean
     * radius of a uniform sample of a disc is 2/3, and anything much under that
     * is a pattern that leaves the edge of the drawn mark safe. */
    const rs = w.shells.map((s) => {
      const dx = s.at.x - m.centre.x, dz = s.at.z - m.centre.z;
      const u = dx * Math.sin(m.bearing) + dz * Math.cos(m.bearing);
      const v = dx * Math.cos(m.bearing) - dz * Math.sin(m.bearing);
      return Math.hypot(u / m.a, v / m.b);
    });
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    assert(mean > 0.5,
      `the shells average ${mean.toFixed(2)} of the way out — sampled without the sqrt, so they `
      + 'crowd the middle and the edge of the drawn mark is a safe place to stand');
    assert(w.shells.every((s) => s.o?.source === HIGH_COMMAND),
      'a shell carried a source that was not High Command — the report would name the wrong killer '
      + 'and `installTeamDamage` would blunt it on your own men');
    return `${SHELLS} shells, all inside the ellipse, mean radius ${mean.toFixed(2)} of it`;
  });

  check('fire mission: no order over empty ground, and never on your own line', () => {
    const w = stubWorld();
    const d = new FireMissionDirector(w, { myTeam: 0 });
    assert(d.issue() === null, 'High Command cut an order over a field with nothing on it');
    /* Hostiles too close to be shelled. */
    for (let i = 0; i < 6; i++) w.enemies.push(body(1, i, DEPTH_NEAR - 20));
    assert(d.issue() === null,
      `an order was laid ${DEPTH_NEAR - 20} m out, inside the ${DEPTH_NEAR} m floor — a fire `
      + 'mission on the ground you are standing on is not an order');
    /* …and too far to reach inside the window. */
    w.enemies.length = 0;
    for (let i = 0; i < 6; i++) w.enemies.push(body(1, i, DEPTH_FAR + 40));
    assert(d.issue() === null, `an order was laid past the ${DEPTH_FAR} m ceiling`);
    /* A knot at a workable depth, and the mark goes on the knot. */
    w.enemies.length = 0;
    for (let i = 0; i < 3; i++) w.enemies.push(body(1, 60, 90 + i * 3));       // the knot
    w.enemies.push(body(1, -70, 95));                                          // a stray
    const m = d.issue();
    assert(m, 'no order over a knot of four hostiles at a workable depth');
    assert(m.inside(V(60, 0, 93)),
      'the mark was not laid on the knot — a battery fires at the largest thing it can see');
    assert(!m.inside(V(-70, 0, 95)), 'the mark swallowed a lone body 130 m from the knot');
    return `empty: no order · ${DEPTH_NEAR - 20} m: no order · ${DEPTH_FAR + 40} m: no order · `
      + 'a knot of three: laid on the knot';
  });

  check('fire mission: the same seed cuts the same shoot', () => {
    const mk = () => {
      const w = stubWorld();
      const d = new FireMissionDirector(w, { myTeam: 0, seed: 4242 });
      d.issue({ centre: V(0, 0, 100), bearing: 0.6 });
      d.authorise({});
      drive(d, 6);
      return w.shells.map((s) => `${s.at.x.toFixed(3)},${s.at.z.toFixed(3)}`).join('|');
    };
    const a = mk(), b = mk();
    assert(a === b, 'the same seed laid two different patterns — a shoot you cannot learn');
    return `${a.split('|').length} shells, identical across two rolls`;
  });

  check('fire mission: the report names you, and the beat says whether you looked', () => {
    assert(killerName(HIGH_COMMAND) === 'your own fire mission',
      `killerName reads "${killerName(HIGH_COMMAND)}" off the shells — PLAN.md §4.9's report has `
      + 'to be able to say who did it, and the answer here is the player');

    const w = stubWorld({ pz: 100 });
    const d = new FireMissionDirector(w, { myTeam: 0 });
    for (let i = 0; i < 4; i++) w.enemies.push(body(1, 6, 104 + i));
    const m = laid(d, w);
    for (let i = 0; i < 2; i++) w.enemies.push(body(0, i * 2, 98, `CT-${1300 + i}`));
    d.authorise({});
    const e = w.command.log.find((x) => x.t === 'mission');
    assert(e, 'authorising wrote nothing to the log the after-action report reads');
    assert(e.friendlies === 2 && !e.verified,
      `the log says friendlies=${e.friendlies} verified=${e.verified} where two of yours were in `
      + 'an unread mark');

    const { beats } = interludeBeats([...w.command.log], 0, { name: 'A ridge' }, {});
    const beat = beats.find((b) => b.kind === 'mission');
    assert(beat, 'the report has no beat for an order that was cleared');
    assert(beat.own, 'the beat for a mark that caught your own men is not flagged as one');
    assert(/fired on their estimate/.test(beat.sub),
      `the beat reads "${beat.sub}" — the report has to say whether the player had looked`);
    assert(beat.sub.includes('CT-1300'), 'the beat names nobody it killed');

    /* …and the same order, read first, reads differently. */
    const w2 = stubWorld({ pz: 100 });
    const d2 = new FireMissionDirector(w2, { myTeam: 0 });
    for (let i = 0; i < 4; i++) w2.enemies.push(body(1, 6, 104 + i));
    laid(d2, w2);
    drive(d2, READ_SECONDS + 0.5);
    d2.authorise({});
    const b2 = interludeBeats([...w2.command.log], 0, { name: 'A ridge' }, {})
      .beats.find((b) => b.kind === 'mission');
    assert(/read it first/.test(b2.sub) && !b2.own,
      `a verified clear mark reads "${b2.sub}" — the two arms of the decision have to read `
      + 'differently in the report or the report is not about the decision');
    return `blind: "${beat.sub}" · checked: "${b2.sub}"`;
  });

  check('fire mission: a grid keeps its name', () => {
    const a = gridName(V(112, 0, 218));
    assert(a === gridName(V(112 + 20, 0, 218 + 20)),
      'two points 20 m apart are two different grids — a player who hears a name twice has to '
      + 'have learned a place');
    assert(a !== gridName(V(112 + 220, 0, 218)), 'ground 220 m away has the same name');
    assert(!/[IO]/.test(a), `the grid letter ${a} can be read as a digit`);
    return `${a} at (112,218), the same at (132,238), different at (332,218)`;
  });

  check('fire mission: their battery reaches the line through the door nobody had installed', () => {
    const w = stubWorld();
    const d = new FireMissionDirector(w, { myTeam: 0 });
    for (let i = 0; i < 6; i++) w.enemies.push(body(0, 40 + i, 60, `CT-${1400 + i}`));
    assert(d.theirBarrage({}), 'a battery in their hands could not reach your line at all');
    drive(d, 6);
    assert(w.shells.length === SHELLS, `their barrage put ${w.shells.length} shells down`);
    const cx = w.shells.reduce((a, s) => a + s.at.x, 0) / w.shells.length;
    const cz = w.shells.reduce((a, s) => a + s.at.z, 0) / w.shells.length;
    assert(Math.hypot(cx - 42.5, cz - 60) < ELLIPSE_A,
      `their barrage landed at (${cx.toFixed(0)},${cz.toFixed(0)}) against a line at (42,60) — the `
      + 'Battery\'s "lost: it fires for them" row is what this is for');
    return `${SHELLS} shells on the line's own centroid, ${Math.hypot(cx - 42.5, cz - 60).toFixed(1)} m off it`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  The two that need a world stepping                                    */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('fire mission: the shells pay full on your own men, whatever the friendly-fire slider says', async () => {
    /**
     * THE CLAUSE. `installTeamDamage` scales a blow whose source is on the
     * target's own side by `teamDamage` — 0.35 by default — and a fire mission
     * your line is standing in must not be survivable because of a slider.
     * HIGH_COMMAND is on nobody's side, so it pays full, and the A/B is the
     * same body, the same distance, the same blast, with the source changed.
     */
    const { Player } = await import('../../src/game/Player.js');
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { installTeamDamage } = await import('../../src/game/Command.js');
    const { Stratagems } = await import('../../src/game/Stratagems.js');

    const world = {
      scene: new THREE.Scene(),
      settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
      terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
        half: 200, surfaceAt: () => 'sand', crater() {}, burn() {} },
      particles: null, time: 0, combatIntensity: 0,
      bolts: { fire() {} }, enemies: [], props: [],
      command: null, support: null,
      lightning: { strike() {} }, addProp() {}, onHitmark() {}, notify() {}, report() {},
      physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
        addJoint() {}, removeJoint() {} },
      engine: { addHeat() {}, hurt() {}, shake() {}, punch() {}, rumble() {},
        camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
      spawnDebrisGroup() {}, spawnDebris() {},
    };
    const p = new Player(world, { isLocal: true });
    p.position.set(0, 0, -60);
    p.team = 0;
    p.stratagems = new Stratagems(p);
    const ctx = { dt: 1 / 60, terrain: world.terrain, enemies: world.enemies, particles: null,
      physics: world.physics, world, camera: world.engine.camera, time: 0 };

    const mk = (z) => {
      const e = new Enemy(world, 'clone', new THREE.Vector3(0, 0, z));
      e.position.set(0, 0, z);
      e.team = 0;
      installTeamDamage(e, 0.35);
      world.enemies.push(e);
      return e;
    };
    /* TWO HUNDRED METRES APART, because one blast that reaches both bodies is
     * one measurement of two things: the first version put them at the same
     * point and the second blast finished a body the first had already
     * halved. */
    const mine = mk(0);
    const theirs = mk(300);
    const hp0 = mine.hp;
    assert(hp0 > 0 && theirs.hp === hp0, 'the two fixture bodies did not start equal');

    /* One blast at each, same place, same numbers: yours as the source, and
     * High Command's as the source. */
    p.stratagems.blast(ctx, new THREE.Vector3(0, 0, 0), 6.5, 70, SHELL_DAMAGE, { core: 0.25, source: p });
    const byYou = hp0 - mine.hp;
    p.stratagems.blast(ctx, new THREE.Vector3(0, 0, 300), 6.5, 70, SHELL_DAMAGE,
      { core: 0.25, source: HIGH_COMMAND });
    const byCommand = hp0 - theirs.hp;
    assert(byYou > 0 && byCommand > 0, 'neither blast reached a body at the centre of it');
    assert(byCommand > byYou * 1.8,
      `your own blast took ${byYou.toFixed(0)} hp off a trooper and High Command's took `
      + `${byCommand.toFixed(0)} — at teamDamage 0.35 the second has to be the full blow, or a `
      + 'fire mission your line is standing in is survivable because of a slider');
    return `teamDamage 0.35: yours ${byYou.toFixed(0)} hp · High Command's ${byCommand.toFixed(0)} hp`;
  });

  check('fire mission: three ways to check an order, and every one of them costs something', async () => {
    /**
     * THE WELD, AND IT IS THE WHOLE SECTION. PLAN.md's test of every system is
     * "delete `lineIsUp` — does this section change?" Delete the quorum and all
     * three arms below collapse into "walk over and look", which is free.
     *
     * The same order on the same ground, answered three ways by the same
     * general with the same ten men, and nothing else differs:
     *
     *   WALK OUT WITH THEM   your line's pace is what moves the formation
     *     anchor (`advancePace`, FLAGSHIP §6), so keeping inside `MORALE.NEAR`
     *     of your men brings all ten into the ellipse you went out to read.
     *   RUN OUT ALONE        outrun them and the anchor stops dead — they are
     *     safe, and they are also not with you, so the quorum is DOWN for the
     *     whole reading and the run does not advance while you check.
     *   PLANT THEM FIRST     `order(id, cmdr, squad)` gives each squad its own
     *     ground, so they hold it, and `lineGathered` counts a planted man as
     *     near where he was TOLD to be. Both costs paid with one verb that
     *     shipped for §4.4 — which is what makes this a skill a player can find
     *     and be right about rather than a trap.
     */
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');

    /* The mark, and the two paces. `LINE_PACE` is under the slowest man's own
     * speed so the anchor keeps up; `SPRINT` is the player's real one. */
    const MARK = 70, LINE_PACE = 3.0, SPRINT = 7.2, SECONDS = 26;

    const arm = ({ plant = false, pace = LINE_PACE }) => {
      const w = stubWorld();
      w.scene = new THREE.Scene();
      w.settings = {}; w.level = LEVELS.geonosis; w.run = null; w.takenBoons = new Set();
      w.statics = []; w.props = []; w.doors = []; w.report = () => {};
      w.difficulty = null; w.hpScale = 1; w.dmgScale = 1;
      w.players = [];
      w.physics = { staticBoxes: [], bodies: [], add() {}, remove() {},
        addStaticBox() { return null; }, removeStaticBox() {}, raycast: () => null };
      w.terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
        size: 400, half: 200, surfaceAt: () => 'sand', crater() {}, flush() {}, slopeAt: () => 0,
        inBounds: () => true };
      w.spawnEnemy = (type, pos) => {
        const e = body(0, pos.x, pos.z);
        e.position.copy(pos);
        e.A = {}; e.type = type; e.world = w; e.speed = 4; e.hp = 100; e.maxHp = 100;
        e.velocity = new THREE.Vector3(); e.facing = 0; e.wish = null; e.toTarget = null;
        e._wallN = new THREE.Vector3(); e._wallT = 0; e._stuckT = 0;
        e._prevPos = new THREE.Vector3();
        e.attackDamage = 0; e.mod = null; e.rig = null; e.group = null;
        e.burstLeft = 0; e.burstTimer = 0; e.attackTimer = 0; e.aimCharge = 0;
        e._move = () => {}; e._syncBody = () => {};
        e.damage = (n) => { e.hp -= n; return e.hp <= 0; };
        w.enemies.push(e);
        return e;
      };
      const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool });
      d.lineAdvances = true;
      const me = w.player;
      me.aimDir = V(0, 0, 1); me.facing = 0; me.alive = true; me.team = 0;
      w.players.push(me);
      d.commander.player = me;
      d.deploy();
      d._troops(1 / 30, {});
      for (const t of d.roster.living) if (t.body) t.body.position.set(0, 0, 0);

      const fm = new FireMissionDirector(w, { myTeam: 0 });
      const m = fm.issue({ centre: V(0, 0, MARK), bearing: 0 });

      /* THE PLANT, when this arm is the one that pays for it. */
      if (plant) for (const [i] of d.squadsOf(d.commander).entries()) d.order('cover', d.commander, i);

      /**
       * EACH MAN IS STOOD WHERE `slotFor` SAYS HE SHOULD BE STANDING, because
       * closing that distance is `Enemy._move`'s job and every fixture of this
       * shape stubs it out (see `spawnEnemy` above, and the same stub in
       * `objectives.mjs`). So this is the limit case of an army that obeys
       * perfectly, which is the right arm to measure: the claim under test is
       * about where the men are TOLD to stand. `slotFor` is the director's own
       * answer and `_anchorFor` — the thing the plant changes — is inside it.
       */
      const step = 1 / 30;
      const seat = new THREE.Vector3();
      let gatheredWhileReading = true;
      for (let i = 0; i < 30 * SECONDS; i++) {
        me.position.z = Math.min(MARK, me.position.z + pace * step);
        d._troops(step, {});
        for (const t of d.roster.living) {
          const b = t.body;
          if (!b || b.dead) continue;
          const at = d.slotFor(b, seat);
          if (at) b.position.set(at.x, 0, at.z);
        }
        fm.update(step, {});
        /* The quorum WHILE THE READING RUNS, which is when it matters: an
         * advance that stops for twelve seconds is what running out alone
         * actually costs. */
        if (m.read > 0 && m.read < 1 && !d.lineGathered(d.commander)) gatheredWhileReading = false;
      }
      fm.authorise({});
      const men = d.roster.living.map((t) => t.body).filter((b) => b && !b.dead);
      return { m, caught: m.caught.friendlies, men: men.length, read: m.read,
               gathered: gatheredWhileReading };
    };

    const walk = arm({ pace: LINE_PACE });
    const run = arm({ pace: SPRINT });
    const planted = arm({ pace: SPRINT, plant: true });

    for (const [name, a] of [['walk', walk], ['run', run], ['planted', planted]]) {
      assert(a.men >= 8, `the ${name} arm deployed ${a.men} men — nothing to measure`);
      assert(a.read >= 1,
        `the ${name} arm did not finish the reading (${a.read.toFixed(2)}) — the fixture is `
        + 'measuring its own walk rather than the decision');
    }
    assert(walk.caught >= 4,
      `walking out to read the mark at the line's own pace caught ${walk.caught} of ${walk.men} men `
      + '— the cost of checking IS that an un-delegated squad forms on your body, and without it '
      + 'the order is free to check');
    assert(run.caught === 0,
      `${run.caught} men were caught by a mark their general sprinted to alone — FLAGSHIP §6 says `
      + 'the line does not come with you, so this arm must be the safe one');
    assert(!run.gathered,
      'the quorum held while the general read the mark from 70 m in front of his own line — then '
      + 'running out alone costs nothing and there is no decision between the three arms');
    assert(planted.caught === 0 && planted.gathered,
      `planting the line first caught ${planted.caught} men and left the quorum `
      + `${planted.gathered ? 'up' : 'down'} — planting is supposed to be the answer, and a player `
      + 'who finds it has to be right about it');
    assert(walk.gathered,
      'the quorum was down even walking out with the line — then no arm keeps the advance and the '
      + 'plant is not buying anything');
    return `walked out with them: ${walk.caught}/${walk.men} of the line in the mark, quorum up · `
      + `sprinted alone: ${run.caught} caught, quorum DOWN for the reading · `
      + `planted first: ${planted.caught} caught, quorum up`;
  });

  check('fire mission: an ellipse is an ellipse, and the long axis points back at the guns', () => {
    const m = new FireMission(V(0, 0, 0), 0);
    assert(m.inside(V(0, 0, ELLIPSE_A - 1)), 'a point just inside the long axis reads as outside');
    assert(!m.inside(V(0, 0, ELLIPSE_A + 1)), 'a point past the long axis reads as inside');
    assert(m.inside(V(ELLIPSE_B - 1, 0, 0)), 'a point just inside the short axis reads as outside');
    assert(!m.inside(V(ELLIPSE_B + 1, 0, 0)),
      `a point ${ELLIPSE_B + 1} m across the mark reads as inside — the ellipse is being tested `
      + 'as a circle, so half the drawn shape is a lie in each direction');
    /* Turned a quarter: the long axis is now across x. */
    const t = new FireMission(V(0, 0, 0), Math.PI / 2);
    assert(t.inside(V(ELLIPSE_A - 1, 0, 0)) && !t.inside(V(0, 0, ELLIPSE_A - 1)),
      'the ellipse does not turn with its bearing');
    assert(m.state === STANDING && m.left === WINDOW, 'a fresh order is not standing on a full window');
    return `${ELLIPSE_A}×${ELLIPSE_B} m, turned with the gun-target line`;
  });

}
