/**
 * BATTLEFRONT BORZ — the six things on the field only your men can hold.
 *
 * `src/game/Objectives.js` is PLAN.md §4.2. Its own note carries the design;
 * this file holds the two properties that make it a design rather than a list,
 * plus one per effect, because an effect that is wired to nothing is a table
 * row and PLAN.md's guardrail #2 is that "every element must change a decision,
 * and its check must demonstrate the decision changing".
 *
 * ── THE TWO THAT MATTER ─────────────────────────────────────────────────
 *
 * A GUN WITHOUT A CREW IS SCENERY. The Jedi cannot crew a battery and fight at
 * once, so a site is held by BODIES and never by the player. If a player
 * standing on the plinth could take a battery, the whole section collapses back
 * into a thing one man does and the named men go back to being a health bar.
 *
 * CREWING TAKES THOSE MEN OUT OF THE QUORUM. This is the clause that welds §4.2
 * to the keystone instead of leaving it a good idea sitting beside one, and
 * PLAN.md states the failure mode outright: "Without this clause §4.2 reads
 * identically with `lineIsUp` deleted." So the check is not "the crew field is
 * populated" — it is that the same ten men, standing in the same places, make
 * `lineGathered` answer differently depending on whether the ground under them
 * is a battery you hold.
 *
 * ── AND THE SHAPE OF THE FIXTURE ────────────────────────────────────────
 *
 * Stubs, not a live World, and that is a deliberate departure from
 * `command.mjs`'s own argument for real worlds. What is being asked here is
 * arithmetic over a rule table — who is inside a radius, what a timer does,
 * which side a multiplier lands on — and none of it is a fact about a world
 * stepping. The two checks that ARE about a world stepping (the shield's push
 * and the vision gate's refusal) drive real objects.
 */

import * as THREE from 'three';
import { ObjectiveField, Objective, OBJECTIVES, OBJECTIVE_IDS, TAKE_SECONDS, SITE_RADIUS }
  from '../../src/game/Objectives.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A world with exactly the fields ObjectiveField reads, and no scene. */
function stubWorld() {
  return {
    scene: null, terrain: { height: () => 0 },
    enemies: [], players: [], notes: [],
    notify(a, b) { this.notes.push([a, b]); },
    support: { got: 0, credit(n) { this.got += n; return n; } },
  };
}

/** A body on `team` standing at (x, z). */
let _n = 0;
const body = (team, x, z) => ({ id: 'b' + (++_n), team, dead: false, position: V(x, 0, z) });

/** Step a field for `seconds` at 1/30. */
function drive(f, seconds) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) f.update(1 / 30, {});
}

export async function run({ check, assert }) {

  check('objectives: six of them, and every one says what it pays and what it costs', () => {
    assert(OBJECTIVE_IDS.length === 6,
      `the table holds ${OBJECTIVE_IDS.length} objectives against the six PLAN.md §4.2 names`);
    for (const id of OBJECTIVE_IDS) {
      const r = OBJECTIVES[id];
      assert(r.crew >= 2, `${id} needs ${r.crew} men — one man is not a crew, it is a passer-by`);
      assert(r.hold && r.lose,
        `${id} does not say what holding it pays or what losing it costs, so a player has no way `
        + 'to decide whether it is worth men');
      assert(r.hold !== r.lose, `${id}'s held and lost lines are the same sentence`);
    }
    return OBJECTIVE_IDS.map((id) => `${id}:${OBJECTIVES[id].crew}`).join(' ');
  });

  check('objectives: a site is held by men, and a Jedi standing on it holds nothing', () => {
    const w = stubWorld();
    const f = new ObjectiveField(w, { myTeam: 0 });
    const site = f.add(new Objective('battery', V(0, 0, 0)));
    /* The player, alone, standing exactly on the plinth. */
    w.players.push({ team: 0, alive: true, position: V(0, 0, 0) });
    drive(f, TAKE_SECONDS * 2);
    assert(site.owner === null,
      'a Jedi standing on a battery for twice the take time took it — "a gun without a crew is '
      + 'scenery" is the whole of §4.2, and if one body can hold a site the named men are '
      + 'decoration again');
    /* Now his men turn up. */
    for (let i = 0; i < OBJECTIVES.battery.crew; i++) w.enemies.push(body(0, i * 2, 0));
    drive(f, TAKE_SECONDS - 1);
    assert(site.owner === null, `the site changed hands after ${TAKE_SECONDS - 1}s against a `
      + `${TAKE_SECONDS}s take timer — one squad walking past would flip a battery`);
    drive(f, 2);
    assert(site.owner === 0, 'three men stood on a battery for the full take time and did not take it');
    return `player alone for ${TAKE_SECONDS * 2}s: nobody's · ${OBJECTIVES.battery.crew} men for `
      + `${TAKE_SECONDS}s: taken`;
  });

  check('objectives: crewing a gun takes those men out of the quorum', async () => {
    /**
     * THE WELD. PLAN.md §4.2: "every objective you hold is ground you cannot
     * advance onto, because the men holding it are not standing with the line."
     *
     * The same men in the same places, twice — once with a battery under three
     * of them and once without. The quorum has to answer differently, or the
     * section reads identically with `lineIsUp` deleted, which is PLAN.md's own
     * stated failure mode for it.
     */
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { MORALE } = await import('../../src/game/Morale.js');

    const w = stubWorld();
    w.scene = new THREE.Scene();
    w.settings = {}; w.level = LEVELS.geonosis; w.run = null; w.takenBoons = new Set();
    w.statics = []; w.props = []; w.doors = []; w.report = () => {};
    w.difficulty = null; w.hpScale = 1; w.dmgScale = 1;
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
    const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0 };
    w.players.push(me); w.player = me; d.commander.player = me;
    d.deploy();
    const men = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(men.length >= 6, `only ${men.length} bodies deployed — nothing to divide`);

    /**
     * THE ARRANGEMENT, AND IT IS BUILT ON THE DELEGATION THAT SHIPPED FOR §4.4.
     *
     * 1st Squad is sent 60 m out and GIVEN THE STANDING ORDER to hold that
     * ground, so under the quorum's own rule ("near what he was told to be near")
     * they count. Of 2nd Squad, two stay on the general and the rest are put out
     * of reach — enough that 1st Squad is what the quorum turns on.
     *
     * So the two arms differ in exactly one bit: whether the ground 1st Squad is
     * holding is a BATTERY they are crewing, or a field. Same men, same places,
     * same order.
     */
    d._troops(1 / 30, {});
    const c = d.commander;
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, `the roster made ${squads.length} squads — nothing to divide`);
    const first = squads[0].map((t) => t.body).filter(Boolean);
    const second = squads[1].map((t) => t.body).filter(Boolean);
    for (const e of first) e.position.set(60, 0, 0);
    second.forEach((e, i) => e.position.set(0, 0, i < 2 ? 2 : 200));
    /**
     * AND THE ORDER IS GIVEN FROM WHERE THEY ARE STANDING, THEN HE WALKS BACK.
     *
     * `cover` is a per-squad order on a non-advancing formation, so it is asked
     * of both gates `order()` now keeps. The reach: `ORDER_REACH` is 34 m from
     * the commander's body or from his pace anchor, and 1st Squad is 60 m out,
     * so shouted from the origin every man in it refuses `out of reach`. And
     * `unled`: an unsupervised hold wants a Sergeant in the squad or the
     * general inside `RELAY_REACH` — 20 m — of its centroid, and 60 m is
     * neither. Refused, `order()` writes nothing, no ground is planted, and the
     * control arm would be measuring a squad that was never given ground rather
     * than one standing on ground it was told to hold.
     *
     * So the general walks the 60 m, gives it at 0 m, and walks back. The plant
     * is taken from the SQUAD's centroid at the moment the order lands and not
     * from his body, so it stays at (60, 0, 0) after he leaves — which is the
     * standing order the quorum reads, and the only version of it worth
     * testing: a post the general has walked away from.
     */
    me.position.set(60, 0, 0);
    const gave = d.order('cover', c, 0);
    me.position.set(0, 0, 0);
    assert(gave === true, 'the standing order the whole A/B is measured against was refused — '
      + `${d.orderRefused || 'no reason recorded'}`);
    assert(d.lineGathered(c),
      'the line was down with 1st Squad standing on the ground it was ordered to hold and before '
      + 'any objective existed — the control arm is broken');

    /* Now the ground they were sent to is a battery, and it is theirs. */
    const f = new ObjectiveField(w, { myTeam: 0 });
    w.objectives = f;
    const site = f.add(new Objective('battery', V(60, 0, 0)));
    site.owner = 0;
    f.update(1 / 30, {});
    assert(f.crewIds().size === first.length,
      `${f.crewIds().size} men read as crew where ${first.length} are standing on the gun`);
    const withGun = d.lineGathered(c);

    site.owner = null;
    f.update(1 / 30, {});
    assert(f.crewIds().size === 0, 'men on a site nobody holds still read as crew');
    const withoutGun = d.lineGathered(c);

    assert(withoutGun,
      'the same men in the same places did not make the quorum with the gun unowned — the A/B is '
      + 'not isolated to the objective');
    assert(!withGun,
      `${first.length} men crewing a battery still counted toward the quorum, so an objective `
      + 'costs the player nothing — and §4.2 reads identically with lineIsUp deleted, which is '
      + 'the exact failure PLAN.md names for this section');
    return `${men.length} men, 1st Squad's ${first.length} ordered to ground 60 m out (quorum `
      + `radius ${MORALE.NEAR} m): a field, and the line is up; a battery they crew, and it is down`;
  });

  check('objectives: the relay is a rate on both sides of the same field', () => {
    const w = stubWorld();
    const f = new ObjectiveField(w, { myTeam: 0 });
    const site = f.add(new Objective('relay', V(0, 0, 0)));
    assert(f.coolRate(0) === 1 && f.coolRate(1) === 1,
      'an unheld relay is already paying somebody');
    site.owner = 0;
    assert(f.coolRate(0) === 2, `holding the relay reads ${f.coolRate(0)}x, not 2x`);
    assert(f.coolRate(1) === 0.5,
      `the side that does NOT hold the relay reads ${f.coolRate(1)}x — the table says losing it `
      + 'costs you a long clock, so it has to bite both ways or it is only a bonus');
    site.owner = 1;
    assert(f.coolRate(0) === 0.5 && f.coolRate(1) === 2, 'the relay does not mirror');
    return 'unheld 1x/1x · yours 2x/0.5x · theirs 0.5x/2x';
  });

  check('objectives: the spire, the foundry and the shield each answer for one side only', () => {
    const w = stubWorld();
    const f = new ObjectiveField(w, { myTeam: 0 });
    const spire = f.add(new Objective('spire', V(0, 0, 0)));
    const foundry = f.add(new Objective('foundry', V(60, 0, 0)));
    const shield = f.add(new Objective('shield', V(-60, 0, 0)));
    assert(!f.seesAll(0) && !f.seesAll(1), 'an unheld spire is already showing somebody the field');
    assert(!f.wallAgainst(0) && !f.wallAgainst(1), 'an unheld shield is already a wall');
    spire.owner = 0; foundry.owner = 0; shield.owner = 0;
    assert(f.seesAll(0) && !f.seesAll(1), 'the spire is not one-sided');
    assert(f.heavyReplacements(0) && !f.heavyReplacements(1), 'the foundry is not one-sided');
    assert(!f.wallAgainst(0), 'the side HOLDING the shield cannot cross its own screen');
    assert(f.wallAgainst(1) === shield,
      'the shield is not a wall to the side that does not hold it, so the row pays nothing');
    return 'spire, foundry and shield all answer for the holder and against the other side';
  });

  check('objectives: both sides over the bar is contested, and contested pays nobody', () => {
    const w = stubWorld();
    const f = new ObjectiveField(w, { myTeam: 0 });
    const site = f.add(new Objective('battery', V(0, 0, 0)));
    site.owner = 0;
    for (let i = 0; i < OBJECTIVES.battery.crew; i++) w.enemies.push(body(0, i, 0));
    for (let i = 0; i < OBJECTIVES.battery.crew; i++) w.enemies.push(body(1, -i, 2));
    const paid = w.support.got;
    drive(f, OBJECTIVES.battery.every + 2);
    assert(site.contested, 'both sides over the crew bar did not read as contested');
    assert(site.owner === 0, 'a contested site changed hands while it was contested');
    assert(w.support.got === paid,
      `a contested battery paid ${w.support.got - paid} support — a fight over a gun has to be `
      + 'able to stop the gun without either side getting it');
    return `${OBJECTIVES.battery.crew} a side on one battery: contested, unchanged, and paying nobody`;
  });

  check('objectives: a battery you hold pays on its own clock, and one you lose fires at you', () => {
    const w = stubWorld();
    let against = 0;
    w.onObjectiveFire = () => { against++; };
    const f = new ObjectiveField(w, { myTeam: 0 });
    const site = f.add(new Objective('battery', V(0, 0, 0)));
    site.owner = 0;
    drive(f, OBJECTIVES.battery.every + 1);
    assert(w.support.got > 0, 'a held battery paid nothing over a full clock');
    assert(against === 0, 'a battery you hold fired on you');
    const paid = w.support.got;
    site.owner = 1; site.clock = OBJECTIVES.battery.every;
    drive(f, OBJECTIVES.battery.every + 1);
    assert(against === 1, `a battery in their hands fired ${against} times over one clock`);
    assert(w.support.got === paid, 'a battery in their hands still paid you support');
    return `held: +${paid.toFixed(0)} support a clock · lost: ${against} fire mission on you`;
  });

  check('objectives: sites are laid along the front, not off to a side nobody was going', () => {
    const w = stubWorld();
    const f = new ObjectiveField(w, { myTeam: 0 });
    let s = 12345;
    const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    f.place({ count: 4, axis: 0, span: 110, rng });
    assert(f.sites.length === 4, `asked for 4 sites and got ${f.sites.length}`);
    const kinds = new Set(f.sites.map((x) => x.kind));
    assert(kinds.size === 4, `4 sites drew ${kinds.size} distinct kinds — the shuffle repeats`);
    /* Along the axis (z here) rather than across it (x). */
    const along = f.sites.map((x) => Math.abs(x.position.z));
    const across = f.sites.map((x) => Math.abs(x.position.x));
    assert(Math.max(...along) > Math.max(...across),
      `the deepest site is ${Math.max(...along).toFixed(0)} m along the front and the widest is `
      + `${Math.max(...across).toFixed(0)} m across it — they are laid sideways, where neither `
      + 'army was going');
    /* Both sides have something, and the middle is up for grabs. */
    const mine = f.sites.filter((x) => x.owner === 0).length;
    const theirs = f.sites.filter((x) => x.owner === 1).length;
    const open = f.sites.filter((x) => x.owner === null).length;
    assert(open >= 1,
      'every site opened in somebody\'s hands — the middle pair are what make the opening minute '
      + 'a fight rather than a race to undefended installations');
    assert(mine >= 1 && theirs >= 1,
      `the opening split is ${mine} yours / ${theirs} theirs / ${open} open — a side that starts `
      + 'with nothing behind it starts the battle already losing');
    return `${f.sites.length} sites: ${mine} yours, ${theirs} theirs, ${open} open · deepest `
      + `${Math.max(...along).toFixed(0)} m along the front`;
  });

  check('objectives: the same seed lays the same field', () => {
    const mk = () => {
      const f = new ObjectiveField(stubWorld(), { myTeam: 0 });
      let s = 777;
      f.place({ count: 5, axis: 0.7, span: 120,
        rng: () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 });
      return f.sites.map((x) => `${x.kind}@${x.position.x.toFixed(2)},${x.position.z.toFixed(2)}`).join('|');
    };
    const a = mk(), b = mk();
    assert(a === b, 'the same seed laid two different fields — a battlefield that reshuffles its '
      + 'objectives between reloads is a battlefield you cannot learn');
    return `${a.split('|').length} sites, identical across two rolls`;
  });

  check('objectives: the radius is bigger than the quorum, so one order does both', async () => {
    const { MORALE } = await import('../../src/game/Morale.js');
    assert(SITE_RADIUS > MORALE.NEAR,
      `the site radius is ${SITE_RADIUS} m against a ${MORALE.NEAR} m quorum radius — a squad `
      + 'ordered onto a site would be gathered without being on it, so crewing would need a '
      + 'second, finer order and the interface would grow a verb for no reason');
    return `${SITE_RADIUS} m site against a ${MORALE.NEAR} m quorum`;
  });

}
