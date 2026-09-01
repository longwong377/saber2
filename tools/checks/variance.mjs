import { modsMoved } from './_shared.mjs';
/**
 * BATTLEFRONT BORZ — the facets that change a rule.
 *
 * PLAN.md §4.6: *"Eight facets that change rules rather than numbers… At least
 * two of the eight must change the QUORUM. Variance that cannot touch the
 * keystone is variance in a side pocket, and this is the difference between
 * melded and parallel."*
 *
 * Six are built, and this file is the acceptance for them. Every check below is
 * an A/B on the same objects in the same state with one card taken, because
 * PLAN.md's guardrail #2 is that a check has to "demonstrate the decision
 * changing" and a card that changes a rule can be measured no other way: there
 * is no number to read off it.
 *
 * THE TWO THAT MATTER are the first two. `lineIsUp` is the keystone — the run
 * does not advance until half your living men are standing where they were told
 * to be — and Skirmish Order and Triage are the only two things in the game
 * that change what that sentence says. If either of them stopped moving the
 * quorum, §4.6 would be a side pocket and this file would be measuring a
 * shopping list.
 */

import * as THREE from 'three';
import { BOONS, boonById } from '../../src/game/Waves.js';
import { FACETS } from '../../src/game/LivingForce.js';
import { defaultBoonMods } from '../../src/game/Player.js';
import { TRIAGE_REACH, DIG_SECONDS } from '../../src/game/Command.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** The six, and what each of them is a rule about. */
const RULES = [
  ['skirmish', 'quorumShare'],
  ['triage', 'triage'],
  ['standfast', 'standfast'],
  ['sapper', 'digRate'],
  ['stormsense', 'stormEyes'],
  ['salvage', 'salvage'],
];

export async function run({ check, assert }) {
  /**
   * THE STREAM THIS FILE DRAWS FROM, PINNED — `determinism.mjs`'s own clause.
   *
   * Every check below builds real `Enemy` bodies, and an Enemy draws from
   * `enemyRng` for its modifier, its strafe side and its spawn jitter. Left
   * unseeded, the numbers this suite reports are a fact about whatever ran
   * before it in the process rather than about the thing being measured — and
   * a bar tightened against one of those readings goes red on an unrelated
   * change. Seeded here rather than taking `clocked` for the whole file,
   * because nothing in here touches shared module state; it only needs the
   * draw to be the same draw twice.
   */
  const { enemyRng } = await import('../../src/game/Enemy.js');
  const { seedWaves } = await import('../../src/game/Waves.js');
  enemyRng.seed(20260824); seedWaves(20260824);


  check('variance: six facets change a rule, and every rule they change is declared', () => {
    const mods = defaultBoonMods();
    const missing = [], nocard = [], nofacet = [];
    for (const [id, field] of RULES) {
      const b = boonById(id);
      if (!b) { nocard.push(id); continue; }
      if (!FACETS.some((f) => f.id === id)) nofacet.push(id);
      if (!(field in mods)) missing.push(`${id} → ${field}`);
      /* AND IT IS A RULE AND NOT A NUMBER: applying it must not touch any of
       * the coefficients the other forty cards move. */
      const p = { boonMods: defaultBoonMods() };
      b.apply(p, 1);
      const moved = modsMoved(p.boonMods, mods);
      assert(moved.length && moved.length <= 2,
        `${id} moves ${moved.length} fields (${moved.join(', ')}) — a facet that changes a rule `
        + 'changes one sentence, and one that changes six is a stat card');
      for (const k of moved) {
        assert(RULES.some(([, f]) => f === k) || k === 'musterShare',
          `${id} writes ${k}, which is one of the numeric coefficients — this block of cards is `
          + 'the one that must not do that');
      }
    }
    assert(!nocard.length, `facets with no card: ${nocard.join(', ')}`);
    assert(!nofacet.length, `cards with no place in the lattice: ${nofacet.join(', ')}`);
    assert(!missing.length,
      `rules written onto boonMods without being declared there: ${missing.join(', ')} — `
      + '`defaultBoonMods` is a closed contract and an undeclared key is one nothing can read');
    return `${RULES.length} rule facets: ${RULES.map(([id]) => id).join(', ')}`;
  });

  check('variance: Skirmish Order moves the keystone, and charges for it', async () => {
    /**
     * THE FIRST OF THE TWO §4.6 REQUIRES. The same ten men, in the same places,
     * asked the same question twice — and the second answer is different only
     * because of one card. This is the objectives-weld shape, applied to the
     * card instead of to the battery.
     */
    const { d, men, c } = await armed();
    /* Four of ten standing with their general and six scattered: under the
     * shipped rule that is not a quorum, and under a third of the living it is. */
    men.forEach((e, i) => e.position.set(i < 4 ? 0 : 300, 0, i < 4 ? 2 : 0));
    const half = d.lineGathered(c);
    d.world.player.boonMods.quorumShare = 1 / 3;
    const third = d.lineGathered(c);
    assert(!half,
      `four of ${men.length} men counted as a quorum under the shipped half — the control arm is broken`);
    assert(third,
      `four of ${men.length} is not a third of the living even with Skirmish Order taken, so the `
      + 'card changes nothing about the one rule the whole mode turns on');

    /* AND THE PRICE IS REAL. The muster's purse is what a run buys men with,
     * and `_areaClear` is the one place a held area pays into it. `area` is a
     * getter off `areaNumber` — the campaign's own table — so the arms differ
     * in the card and in nothing else, including the ground. */
    const paid = [];
    for (const share of [1, 0.5]) {
      d.world.player.boonMods.musterShare = share;
      d.roster.points = 0;
      d.done = false;
      d.awaitingLine = false;
      d._areaClear();
      paid.push(d.roster.points);
    }
    assert(paid[0] > 0, 'holding an area paid nothing at all — the control arm is broken');
    assert(paid[1] < paid[0],
      `the muster paid ${paid[1]} with the card and ${paid[0]} without — taking ground with a third `
      + 'of your men has to cost the men you are paid for taking it with, or the card is a discount');
    return `4 of ${men.length}: half says no, a third says yes · muster ${paid[0]} → ${paid[1]}`;
  });

  check('variance: Triage counts a man on the ground while somebody is over him', async () => {
    /**
     * THE SECOND. §4.9's clause is that a downed man does NOT count — that is
     * what makes the bleed-out window cost something — and this card changes
     * which way the tension pulls without deleting it: he counts only while
     * another living man is standing over him, so the player spends men on
     * holding casualties instead of on holding ground.
     */
    const { d, men, c } = await armed();
    /* Three standing on the general, three down beside them, four gone. */
    men.forEach((e, i) => {
      if (i < 3) e.position.set(0, 0, 1);
      else if (i < 6) { e.position.set(0, 0, 2); e.downed = true; }
      else e.position.set(300, 0, 0);
    });
    const shipped = d.lineGathered(c);
    d.world.player.boonMods.triage = true;
    const triaged = d.lineGathered(c);
    assert(!shipped, 'three of ten standing already made the quorum — the control arm is broken');
    assert(triaged,
      'the three men on the ground did not count even with a living man standing over them, so '
      + 'Triage changes nothing');

    /* …AND ONLY WHILE SOMEBODY IS THERE. Move the living men away and the
     * casualties stop counting again — the card is about the medic, not about
     * the casualty. */
    for (let i = 0; i < 3; i++) men[i].position.set(0, 0, 2 + TRIAGE_REACH * 3);
    assert(!d.lineGathered(c),
      `a downed man counted with the nearest living man ${TRIAGE_REACH * 3} m away — the card would `
      + 'then be "the downed always count", which deletes §4.9\'s tension rather than changing it');
    return `3 down: no · with a man over them: yes · with him ${TRIAGE_REACH * 3} m away: no`;
  });

  check('variance: Stand Fast turns a rout into a place', async () => {
    const { d, c } = await armed();
    const Cmd = await import('../../src/game/Command.js');
    const t = d.roster.living[0];
    const e = t.body;
    /* He is holding ground 40 m from his general and he has broken. */
    e.position.set(40, 0, 0);
    t.morale = Cmd.MORALE.BREAK * 0.9;
    t.broken = true;
    c.player.position.set(0, 0, 0);
    /* WHERE `steer` SENDS HIM, and not how far he gets: `steer` writes a wish
     * and `Enemy._move` is what closes the distance, which every fixture of
     * this shape stubs out. The destination IS the rule. */
    const before = wishOf(d, e, c);
    d.world.player.boonMods.standfast = true;
    const after = wishOf(d, e, c);
    assert(before !== null,
      'a broken man was given nowhere to go at all — the control arm is broken');
    assert(before < 30,
      `a broken man was sent ${before.toFixed(0)} m from his general — the shipped rule is that he `
      + 'walks home, so the fixture is not measuring a rout');
    assert(after === null || after > 35,
      `with Stand Fast he still heads for ground ${after?.toFixed(0)} m from his general — the card `
      + 'is supposed to leave him where he stands');
    return `broken at 40 m: sent home (${before.toFixed(0)} m out) · with Stand Fast: he holds`;
  });

  check('variance: Field Engineering digs the position in half the time', async () => {
    const { d, c } = await armed();
    const squads = d.squadsOf(c);
    /**
     * TWENTY METRES, NOT FIFTY — AND THE DIFFERENCE IS A FEATURE.
     *
     * They were put at 50 m to give them clear ground to dig on, which was
     * free until orders grew a range. `Command.ORDER_REACH` is 34 m: past it a
     * squad cannot hear you and the order is refused out loud, which is the
     * whole point of it. So a fixture that stands them fifty metres off and
     * shouts is testing the refusal, not the dig rate, and it reported "the
     * card promises a 22 s job in half the time" about a card that was never
     * asked for anything.
     *
     * Far enough to be their own ground, near enough to be given an order.
     */
    for (const t of squads[0]) if (t.body) t.body.position.set(20, 0, 0);
    d.order('digin', c, 0);
    const step = (secs) => { for (let i = 0; i < secs * 30; i++) d._troops(1 / 30, {}); };
    d.world.player.boonMods.digRate = 2;
    step(DIG_SECONDS * 0.52 + 0.5);
    assert(d.world.craters.length === 1,
      `${DIG_SECONDS * 0.52} s of digging at double rate left ${d.world.craters.length} positions — `
      + `the card promises a ${DIG_SECONDS} s job in half the time`);
    return `${DIG_SECONDS} s → ${(DIG_SECONDS / 2).toFixed(0)} s`;
  });

  check('variance: Storm Sense breaks the one symmetry the sight model has', async () => {
    /**
     * `Smoke.js` cannot know who fired and must not — that is what makes a
     * smoke screen a decision rather than a free win — so the asymmetry lives
     * on the body doing the looking, and only for the player's own side.
     *
     * ONE SHOOTER, ONE TARGET, THREE ARMS. The side is changed on the SAME
     * body rather than by building a second one: a fresh Enemy's rig has not
     * been posed, so its muzzle sits at its own origin and a two-body fixture
     * would be measuring a 0.4 m sightline against a 40 m one.
     */
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { setAir, clearAir } = await import('../../src/game/Smoke.js');
    const world = stubWorld();
    const shooter = new Enemy(world, 'clone', V(0, 0, 0));
    const mark = new Enemy(world, 'b1', V(0, 0, 40));
    shooter.position.set(0, 0, 0);
    shooter.team = 0; mark.team = 1;
    shooter.target = mark;
    world.player = { team: 0, boonMods: defaultBoonMods(), position: V(0, 0, 0) };
    const ctx = { physics: world.physics, terrain: null };
    clearAir();
    assert(shooter._hasLineOfSight(ctx),
      'a shooter cannot see a body 40 m away in clear air — the fixture is broken before the '
      + 'storm is in it');
    setAir(0.02);
    assert(!shooter._hasLineOfSight(ctx),
      'the storm did not blind him before the card was taken — the control arm is broken');
    world.player.boonMods.stormEyes = 0.5;
    assert(shooter._hasLineOfSight(ctx),
      'your own line still cannot see through the storm with Storm Sense taken');
    /* THE SAME BODY, THE OTHER SIDE. */
    shooter.team = 1;
    assert(!shooter._hasLineOfSight(ctx),
      'the card handed the other army the same eyes — it is the one thing in the game allowed to '
      + 'be one-sided, and it has to actually be one-sided');
    shooter.team = 0;
    clearAir();
    return 'the same storm at 40 m: your line sees, theirs does not';
  });

  check('variance: Salvage pays for an act that has never paid anything', async () => {
    const { World } = await import('../../src/game/World.js');
    const w = Object.create(World.prototype);
    w.communion = { insight: 0, earned: 0 };
    w.player = { boonMods: defaultBoonMods() };
    assert(w.onPropBroken() === 0, 'breaking cover paid Insight with no card taken');
    assert(w.communion.insight === 0, 'the ledger moved anyway');
    w.player.boonMods.salvage = true;
    const paid = w.onPropBroken();
    assert(paid > 0 && w.communion.insight === paid,
      `Salvage paid ${paid} and the ledger holds ${w.communion.insight}`);
    assert(w.communion.earned === paid,
      'the Insight arrived without being recorded as earned — `runCarry` reads `earned`, so a '
      + 'ground change would forget it');
    /* AND THE DOOR IS INSTALLED WHERE THINGS BREAK. */
    const { readFile } = await import('node:fs/promises');
    const props = await readFile(new URL('../../src/world/Props.js', import.meta.url), 'utf8');
    assert(/onPropBroken\?\.\(/.test(props),
      'nothing calls onPropBroken — the card pays for an event nothing reports');
    return `+${paid} Insight a prop, and nothing without the card`;
  });

}

/* ── fixtures ─────────────────────────────────────────────────────────── */

/** Where `steer` is sending this man, as a distance from his general, or null. */
function wishOf(d, e, c) {
  e.wish = null;
  d.steer(e, 1 / 30, {});
  if (!e.wish) return null;
  const p = c.player.position;
  return Math.hypot(e.wish.x - p.x, e.wish.z - p.z);
}

/** A real director over stub bodies — `objectives.mjs`'s fixture, once more. */
async function armed() {
  const Cmd = await import('../../src/game/Command.js');
  const { LEVELS } = await import('../../src/game/Levels.js');
  const world = stubWorld();
  world.level = LEVELS.geonosis;
  world.craters = [];
  world.terrain.crater = (x, z, r, dd, rim) => world.craters.push({ x, z, r, d: dd, rim });
  let n = 0;
  world.spawnEnemy = (type, pos) => {
    const e = {
      id: 'b' + (++n), team: 0, dead: false, downed: false, position: pos.clone(),
      A: {}, type, world, speed: 4, hp: 100, maxHp: 100,
      velocity: new THREE.Vector3(), facing: 0, wish: null, toTarget: null,
      _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0, _prevPos: new THREE.Vector3(),
      attackDamage: 0, mod: null, rig: null, group: null,
      burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
      _move() {}, _syncBody() {},
      damage(v) { this.hp -= v; return this.hp <= 0; },
    };
    world.enemies.push(e);
    return e;
  };
  const d = new Cmd.CommandDirector(world, { pool: LEVELS.geonosis.pool });
  d.lineAdvances = true;
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0,
               boonMods: defaultBoonMods() };
  world.players.push(me); world.player = me; d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  const men = d.roster.living.map((t) => t.body).filter(Boolean);
  if (men.length < 8) throw new Error(`the fixture mustered ${men.length} men`);
  return { d, men, c: d.commander, world };
}

function stubWorld() {
  return {
    scene: new THREE.Scene(), settings: {}, time: 0, run: null, takenBoons: new Set(),
    enemies: [], players: [], props: [], doors: [], statics: [],
    difficulty: null, hpScale: 1, dmgScale: 1,
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      inBounds: () => true, half: 200, size: 400, surfaceAt: () => 'sand', crater() {},
      flush() {}, slopeAt: () => 0 },
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {}, raycast: () => null,
      addStaticBox() { return null; }, removeStaticBox() {} },
    report() {}, notify() {},
  };
}
