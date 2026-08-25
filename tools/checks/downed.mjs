/**
 * BATTLEFRONT BORZ — a named man goes down before he dies.
 *
 * PLAN.md §4.9. `Enemy._mayGoDown` and `_tickDown` carry the design; this file
 * holds the properties that decide whether it is a feature or the game.
 *
 * ── THE ONE THAT DECIDES IT ─────────────────────────────────────────────
 *
 * "And a downed man does NOT count toward the quorum. This is a decision, it is
 * free to take, and it decides whether this section is a feature or the game.
 * If a bleeding man still counted, dragging would be optional and the bleed-out
 * window would be decoration."
 *
 * So the check that matters is not that a man goes down — it is that going down
 * takes him out of the advance, which puts the bleed-out window and the quorum
 * rule in direct tension. Everything else here is the guard rail around that:
 * the window has to be a window (a clock, not a state), the finish has to be
 * reachable (something standing over him ends it), and the recovery has to be a
 * reprieve rather than a heal.
 *
 * ── AND WHAT MUST NOT HAPPEN ────────────────────────────────────────────
 *
 * A bleed-out window is a second health bar unless it is bounded on all sides,
 * so three of these are refusals: an unnamed droid does not get one, a man cut
 * in half does not get one, and a man who has already been down and finished is
 * dead rather than down again.
 */

import * as THREE from 'three';
import { DOWN_BLEED, DOWN_FINISH, FINISH_RATE, DOWN_HELP, DOWN_REVIVE, DOWN_UP_HP }
  from '../../src/game/Enemy.js';
import { MODES } from '../../src/game/Waves.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert }) {

  /**
   * A body with exactly the fields the down machinery touches, and a world with
   * exactly the fields it reads. Stubs, because what is being asked is
   * arithmetic over a clock and a radius — the checks that need a stepping
   * world are in `command.mjs`, which pays thirty seconds each for them.
   */
  const mk = async () => {
    const { Enemy } = await import('../../src/game/Enemy.js');
    const world = {
      enemies: [], players: [], notes: [],
      notify(a, b) { this.notes.push([a, b]); },
      command: { log: [], areaNumber: 1, wave: 1, commander: { side: 0 } },
      director: { downedMen: true },
      time: 0,
      onEnemyKilled() {},
      /* `die` for real reaches the physics world and the LOD ladder. The stub
       * carries exactly what it touches, which is also a useful assertion: a
       * `die` that quietly started reading a fourteenth field would fail here
       * rather than in a browser. */
      physics: { remove() {}, add() {} },
      scene: { add() {}, remove() {} },
      corpses: { take() {} },
      cohorts: null,
    };
    const e = Object.create(Enemy.prototype);
    e.world = world;
    e.id = 'x1'; e.team = 0; e.dead = false; e.downed = false;
    e.hp = 100; e.maxHp = 100; e.stunTimer = 0;
    e.position = V(0, 0, 0); e.velocity = new THREE.Vector3();
    e.trooper = { name: 'CT-1500', label: 'trooper', rankRec: { short: 'CT' }, alive: true };
    e.actor = null; e.A = {}; e.dying = 0;
    e.cry = () => {}; e.recover = () => {};
    e.body = {}; e.bodyRemoved = false;
    e.lod = 0; e._l2 = null; e._l3 = null; e._l2Wait = false; e._l3Wait = false;
    e.rig = null; e.group = null; e.saber = null; e.weapon = null;
    e.built = null; e.mod = null; e.hum = null; e.shieldMesh = null;
    e.rallyRing = null; e.offSaber = null; e.telegraphArc = null;
    e.cloak = null; e.hoodDrape = null; e.skirt = null;
    world.enemies.push(e);
    return { world, e, Enemy };
  };

  const foe = (world, x, z) => {
    const o = { id: 'f' + world.enemies.length, team: 1, dead: false, downed: false,
                position: V(x, 0, z) };
    world.enemies.push(o);
    return o;
  };
  const friend = (world, x, z) => {
    const o = { id: 'a' + world.enemies.length, team: 0, dead: false, downed: false,
                position: V(x, 0, z) };
    world.enemies.push(o);
    return o;
  };

  check('downed: the mode declares it, and the one that runs the quorum is the one that has it', () => {
    assert(MODES.theline?.downed === true,
      'The Line does not declare `downed` — the mode whose whole advance rule is a quorum is the '
      + 'one the bleed-out window is in tension with');
    assert(!MODES.command?.downed,
      'Command declares `downed`. Without a quorum there is nothing for the window to be in '
      + 'tension with, so it would be a free second health bar on every trooper');
    return 'theline: downed · command: not';
  });

  check('downed: a named man does not die at zero, he goes down on a clock', async () => {
    const { e } = await mk();
    e.die(null, null, 'bolt');
    assert(!e.dead, 'a named man at zero hp died outright — there is no window');
    assert(e.downed, 'he did not go down either, so he is in neither state');
    /* `e.bleed === DOWN_BLEED` was the imported constant against the only line
     * that writes it — a stub assigning it would have passed. What is worth
     * asserting here is that the window is a WINDOW: long enough to cross a
     * frame and be seen, and off the table rather than typed. The clock itself
     * is driven to both sides of it by the next check. */
    assert(e.bleed === DOWN_BLEED && DOWN_BLEED > 1,
      `the window opened at ${e.bleed}s against DOWN_BLEED ${DOWN_BLEED}`);
    assert(e.hp > 0,
      'a downed man is sitting at zero hp — every damage path in Enemy tests `hp <= 0`, so the '
      + 'next stray bolt in the volley that dropped him would re-kill him and the window would '
      + 'be one frame long');
    return `down at ${e.bleed}s, ${e.hp} hp, still in the list`;
  });

  check('downed: an unnamed droid gets no window, and neither does a man cut in half', async () => {
    const a = await mk();
    a.e.trooper = null;
    a.e.die(null, null, 'bolt');
    assert(a.e.dead && !a.e.downed,
      'a body with no roster record went down — forty ragdolls a wave nobody has a reason to go '
      + 'back for, and the whole point of the mechanic is that the man on the ground is somebody');

    const b = await mk();
    b.e.die(null, null, 'sever');
    assert(b.e.dead && !b.e.downed, 'a severed body went down instead of dying');

    const c = await mk();
    c.world.director.downedMen = false;
    c.e.die(null, null, 'bolt');
    assert(c.e.dead && !c.e.downed,
      'a mode that has not asked for the window got one anyway');
    return 'no record: dead · severed: dead · mode says no: dead';
  });

  check('downed: nothing near him and the clock runs to the end, and then he is dead', async () => {
    const { e } = await mk();
    e.die(null, null, 'bolt');
    for (let i = 0; i < Math.round((DOWN_BLEED - 1) * 30); i++) e._tickDown(1 / 30);
    assert(e.downed && !e.dead, `he died ${DOWN_BLEED - 1}s into a ${DOWN_BLEED}s window`);
    for (let i = 0; i < 60; i++) e._tickDown(1 / 30);
    assert(e.dead, `he was still down ${DOWN_BLEED + 1}s into a ${DOWN_BLEED}s window`);
    assert(!e.downed, 'he is dead and still flagged down, so the quorum would go on excluding a corpse');
    return `alone: alive at ${DOWN_BLEED - 1}s, gone by ${DOWN_BLEED + 1}s`;
  });

  check('downed: something standing over him finishes it, and it is a rate and not an instant', async () => {
    const { world, e } = await mk();
    e.die(null, null, 'bolt');
    foe(world, DOWN_FINISH - 1, 0);
    e._tickDown(1 / 30);
    assert(!e.dead,
      'a hostile within reach killed him on the first frame — an instant finish makes the window '
      + 'worthless the moment anything is near, and a rate is what makes clearing the ground '
      + 'round him buy the time');
    const want = DOWN_BLEED / FINISH_RATE;
    for (let i = 0; i < Math.round((want + 0.5) * 30); i++) e._tickDown(1 / 30);
    assert(e.dead, `${want.toFixed(1)}s with a hostile over him and he is still alive — the `
      + `finish rate of ${FINISH_RATE}x is not being applied`);
    /* And the same hostile one metre outside the radius does nothing. */
    const b = await mk();
    b.e.die(null, null, 'bolt');
    foe(b.world, DOWN_FINISH + 1, 0);
    for (let i = 0; i < Math.round((want + 0.5) * 30); i++) b.e._tickDown(1 / 30);
    assert(!b.e.dead,
      `a hostile ${DOWN_FINISH + 1} m away finished him inside the ${DOWN_FINISH} m radius`);
    return `over him: ${want.toFixed(1)}s (${FINISH_RATE}x) · ${DOWN_FINISH + 1} m away: the full window`;
  });

  check('downed: a comrade holds the clock and gets him up, and he is not the man he was', async () => {
    const { world, e } = await mk();
    e.die(null, null, 'bolt');
    friend(world, DOWN_HELP - 0.5, 0);
    for (let i = 0; i < Math.round((DOWN_REVIVE - 0.5) * 30); i++) e._tickDown(1 / 30);
    assert(e.downed, `he stood up ${DOWN_REVIVE - 0.5}s into a ${DOWN_REVIVE}s revive`);
    for (let i = 0; i < 60; i++) e._tickDown(1 / 30);
    assert(!e.downed && !e.dead, 'a comrade knelt next to him for the full revive and he did not get up');
    const want = e.maxHp * DOWN_UP_HP;
    assert(Math.abs(e.hp - want) < 0.51,
      `he stood up with ${e.hp} hp against ${want} — a recovery that heals is a recovery worth `
      + 'letting a man go down for');
    assert(e.hp < e.maxHp * 0.5,
      'a saved man came back at more than half health, so saving him is better than not being hit');
    /* TWO MEN ARE FASTER THAN ONE — the reason a squad is a squad. */
    const b = await mk();
    b.e.die(null, null, 'bolt');
    friend(b.world, 1, 0); friend(b.world, -1, 0);
    let t = 0;
    while (b.e.downed && t < DOWN_REVIVE) { b.e._tickDown(1 / 30); t += 1 / 30; }
    assert(!b.e.downed && t < DOWN_REVIVE * 0.75,
      `two men took ${t.toFixed(2)}s against one man's ${DOWN_REVIVE}s — the revive does not scale `
      + 'with how many people are helping, so there is no reason to send more than one');
    return `one man: ${DOWN_REVIVE}s to a ${(DOWN_UP_HP * 100) | 0}% recovery · two men: ${t.toFixed(2)}s`;
  });

  check('downed: a comrade beats a hostile — the clock stops even with something over him', async () => {
    const { world, e } = await mk();
    e.die(null, null, 'bolt');
    foe(world, DOWN_FINISH - 1, 0);
    friend(world, 1, 0);
    for (let i = 0; i < Math.round(DOWN_REVIVE * 30) + 30; i++) e._tickDown(1 / 30);
    assert(!e.dead,
      'a man was finished while one of his own was kneeling over him — the whole picture §4.9 '
      + 'asks for is recovering the wounded UNDER FIRE, and if a nearby hostile beats the medic '
      + 'the answer is always to clear the ground first and there is no decision');
    assert(!e.downed, 'he was neither finished nor saved with a comrade on him for the full revive');
    return 'a comrade over him outranks a hostile near him';
  });

  check('downed: he stays alive on the roll, and out of the fight', async () => {
    const { e } = await mk();
    e.die(null, null, 'bolt');
    assert(e.trooper.alive !== false,
      'going down took him off the roll — a downed man is not a casualty yet, and the roster '
      + 'saying otherwise is what would make the window cosmetic');
    e.wish = new THREE.Vector3(1, 0, 0);
    e.target = {};
    e._think(1 / 30, {});
    assert(!e.wish && !e.target,
      'a downed man went on picking targets and steering — without this the bleed-out window is '
      + 'a prone-stance buff');
    return 'on the roll, off the field';
  });

}
