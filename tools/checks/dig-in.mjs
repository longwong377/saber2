/**
 * BATTLEFRONT BORZ — DIG IN, and whether a hole in the ground is cover.
 *
 * PLAN.md §4.7, in one sentence: *"the ground remembers visually, and `Dig In`
 * is what makes it cover. A sapper turning a crater into a real position is the
 * only thing that produces defilade, because artillery measurably does not."*
 *
 * That is two claims and both are measurable with the shipped hit test, so the
 * first check in this file measures them rather than asserting the feature
 * exists (PLAN.md guardrail #2). Bolts are raycast against the physics world in
 * `World._boltHitTest` and the heightfield is a collider in it — rebuilt within
 * a quarter second of any deformation, see `RapierWorld._refreshHeightfield` —
 * so a berm is cover in the only sense this game has: it stops the ray.
 *
 * THE BODY HEIGHTS ARE MEASURED AND NOT ASSUMED. `Combat.aimAt` resolves a
 * shooter's aim onto `body.chest`, which sits 1.17 m up on a clone; the muzzle
 * a bolt actually leaves from is the median of 666 bolts fired in a live
 * ninety-second fight, 1.15 m. Those two numbers are two centimetres apart,
 * which is why the defilade a position gives is SYMMETRIC and why that is
 * stated in the design rather than tuned away.
 *
 * The rest of the file is the order: what it costs, who may dig, and what
 * happens to the work when the squad is sent somewhere else. Those are
 * arithmetic over a rule table and use stubs, the same split `objectives.mjs`
 * argues for.
 */

import * as THREE from 'three';
import { FORMATIONS, DIG_SECONDS, DIG_CREW, DIG_R, DIG_DEPTH, DIG_RIM, DIG_WORK_R }
  from '../../src/game/Command.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Where a bolt leaves a trooper, and where one is aimed. Both measured. */
const MUZZLE_Y = 1.15, CHEST_Y = 1.17;

/** The ranges and bearings the twelve rays are fired on. */
const RANGES = [30, 50, 70];
const BEARINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export async function run({ check, assert }) {

  check('dig in: shelling ground does not make cover, and digging it does', async () => {
    /**
     * THE SECTION'S OWN CLAIM, AS A TABLE. Three grounds, one spot, twelve rays
     * each — three ranges by four bearings — from a shooter's muzzle to the
     * chest of a man standing on the spot, through the real physics world the
     * real bolt hit test uses.
     */
    const { bootWorld } = await import('./_coop.mjs');
    /* LOW QUALITY, and that is the point rather than a saving: the terrain
     * grid is a quality setting (3.39 m a cell here against 2.48 at high), so
     * the COARSEST tier is the one that decides whether a position is
     * representable at all. A dig tuned at high quality would be a rounding
     * error on the tier most players are on. */
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'theline', level: 'geonosis', quality: 'low' },
      runSeed: 3, spawn: false,
    });
    const T = world.terrain;
    const h = (x, z) => T.height(x, z);

    /* FLAT-ISH GROUND, FOUND RATHER THAN ASSUMED. A position dug on a slope
     * measures the slope. */
    let spot = null;
    for (let x = -120; x <= 120 && !spot; x += 12) {
      for (let z = -120; z <= 120; z += 12) {
        const y = h(x, z);
        let ok = true;
        for (const [dx, dz] of [[9, 0], [-9, 0], [0, 9], [0, -9], [13, 0], [-13, 0]]) {
          if (Math.abs(h(x + dx, z + dz) - y) > 0.35) { ok = false; break; }
        }
        if (ok) { spot = { x, z }; break; }
      }
    }
    assert(spot, 'no ground flat enough to dig on anywhere on the field');

    /* The heightfield collider is rebuilt on a 0.25 s timer, so the world has
     * to be stepped past it before a ray can see what was just dug. */
    const settle = () => { T.flush(); world.physics.step(0.26); world.physics.step(0.26); };
    const blockedIn = () => {
      const floor = h(spot.x, spot.z);
      const chest = V(spot.x, floor + CHEST_Y, spot.z);
      let blocked = 0, n = 0;
      for (const R of RANGES) {
        for (const b of BEARINGS) {
          const sx = spot.x + Math.sin(b) * R, sz = spot.z + Math.cos(b) * R;
          const from = V(sx, h(sx, sz) + MUZZLE_Y, sz);
          const dir = new THREE.Vector3().subVectors(chest, from);
          const len = dir.length();
          dir.multiplyScalar(1 / len);
          n++;
          if (world.physics.raycast(from, dir, len, (bd) => bd.static)) blocked++;
        }
      }
      return { blocked, n };
    };

    const flat = blockedIn();
    assert(flat.blocked === 0,
      `${flat.blocked} of ${flat.n} rays were already blocked on open ground — the fixture is `
      + 'measuring the terrain and not the position');

    /* ARM 1: ARTILLERY. The shell this game actually fires — `Stratagems`'
     * barrage lands 6.5 m blasts and `Terrain.crater` is called at 2.6 m for
     * the big ones — laid dead on the spot, which is the most generous case. */
    T.crater(spot.x, spot.z, 2.6, 0.22, 0.22);
    settle();
    const shelled = blockedIn();
    assert(shelled.blocked <= 3,
      `a single shell crater blocked ${shelled.blocked} of ${shelled.n} rays — if artillery makes `
      + 'cover then §4.7 has no subject and Dig In is a second way to do a thing the guns already do');

    /* ARM 2: A SAPPER. The same ground, dug. */
    T.crater(spot.x, spot.z, DIG_R, DIG_DEPTH, DIG_RIM);
    settle();
    const dug = blockedIn();
    const floor = h(spot.x, spot.z);
    let berm = -Infinity;
    for (let d = 0.6; d <= 1.3; d += 0.05) berm = Math.max(berm, h(spot.x + d * DIG_R, spot.z));
    assert(dug.blocked >= 11,
      `a dug position blocked only ${dug.blocked} of ${dug.n} rays — cover from three bearings of `
      + 'four is cover a player cannot trust, and the numbers to move are DIG_DEPTH and DIG_RIM');
    assert(dug.blocked > shelled.blocked * 3,
      `shelling blocked ${shelled.blocked} and digging blocked ${dug.blocked} — §4.7's whole claim `
      + 'is that those two are different kinds of ground');
    world.unload();
    return `flat ${flat.blocked}/12 · one shell ${shelled.blocked}/12 · dug ${dug.blocked}/12 `
      + `(floor ${floor.toFixed(2)} m, berm ${berm.toFixed(2)} m, grid ${T.step.toFixed(2)} m)`;
  });

  check('dig in: a squad digs its own ground, and its hands are full while it does', async () => {
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { world, d, squads } = await armed(Cmd, LEVELS);

    /* 1st Squad is put on its own ground and told to dig it. */
    const first = squads[0];
    for (const t of first) if (t.body) t.body.position.set(50, 0, 0);
    d.order('digin', d.commander, 0);
    /* `holdFire` is Waves.js's own primitive and what it does to a body with
     * no class behind it is push the attack fuse back up to 0.5 — see that
     * function's own note about the stand-in objects checks hold up. So the
     * fuse is what a held squad looks like from out here. */
    const fuse = () => first.map((t) => t.body?.attackTimer ?? 0);
    for (const t of first) if (t.body) t.body.attackTimer = 0;
    step(d, 2);
    const held = fuse();
    assert(!world.craters.length, `the position was dug after 2 s of a ${DIG_SECONDS} s job`);
    assert(held.some((f) => f > 0),
      'a digging squad kept its fuse down — the price of a position is the fire it gives up, and '
      + 'without that the order is free');

    step(d, DIG_SECONDS);
    assert(world.craters.length === 1,
      `${world.craters.length} holes in the ground after ${DIG_SECONDS} s of digging`);
    const c = world.craters[0];
    assert(Math.hypot(c.x - 50, c.z) < 12,
      `the position was dug at (${c.x.toFixed(0)},${c.z.toFixed(0)}) and the squad was told to hold `
      + '(50,0) — a position that is not where the men are is not their position');
    assert(c.r === DIG_R && c.d === DIG_DEPTH && c.rim === DIG_RIM,
      `the scrape was cut at ${c.r}/${c.d}/${c.rim} rather than the measured ${DIG_R}/${DIG_DEPTH}/${DIG_RIM}`);

    /* …AND THE HANDS COME BACK. */
    for (const t of first) if (t.body) t.body.attackTimer = 0;
    step(d, 1);
    assert(fuse().every((f) => f === 0),
      'the squad was still holding its fire after the position was finished — the price is the '
      + 'digging, not the position');

    /* AND IT IS DUG ONCE. */
    step(d, DIG_SECONDS * 2);
    assert(world.craters.length === 1,
      `${world.craters.length} positions from one order — a squad standing in its own hole is not `
      + 'digging a second one');
    return `${DIG_SECONDS} s, fire held throughout, one ${DIG_R} m position at the squad's own ground`;
  });

  check('dig in: one man is not a working party, and a new order abandons the work', async () => {
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { world, d, squads } = await armed(Cmd, LEVELS);
    const first = squads[0];
    /* One man on the ground, the rest of his squad two hundred metres away. */
    first.forEach((t, i) => { if (t.body) t.body.position.set(i === 0 ? 50 : 250, 0, 0); });
    d.order('digin', d.commander, 0);
    step(d, DIG_SECONDS * 1.5);
    assert(!world.craters.length,
      `one man dug a ${DIG_R} m position on his own in ${DIG_SECONDS} s — DIG_CREW is ${DIG_CREW}`);

    /* His squad turns up and the work starts. */
    for (const t of first) if (t.body) t.body.position.set(50, 0, 0);
    step(d, DIG_SECONDS * 0.6);
    assert(!world.craters.length, 'the position finished early');
    /* …and then they are sent somewhere else. */
    d.order('charge', d.commander, 0);
    d.order('digin', d.commander, 0);
    step(d, DIG_SECONDS * 0.6);
    assert(!world.craters.length,
      'the work banked across an order that pulled the squad off it — "dig in, charge, dig in" '
      + 'would then be a way to have the position without ever standing still for it');
    step(d, DIG_SECONDS * 0.6);
    assert(world.craters.length === 1, 'a squad that started again never finished');
    return `alone for ${(DIG_SECONDS * 1.5) | 0} s: nothing · pulled off at 60%: starts again · `
      + `${DIG_CREW} men for ${DIG_SECONDS} s: a position`;
  });

  check('dig in: the position is cut through the one door that breaks ground', async () => {
    /**
     * `Terrain.crater` and nothing else, which is what makes a position
     * persist: `CraterLog` wraps that one method (see its header on why it
     * wraps rather than being threaded through five callers), so a scrape dug
     * in engagement two is replayed onto engagement three's ground without
     * Command.js knowing that persistence exists.
     */
    const { CraterLog } = await import('../../src/world/CraterLog.js');
    const Cmd = await import('../../src/game/Command.js');
    const { LEVELS } = await import('../../src/game/Levels.js');
    const { world, d, squads } = await armed(Cmd, LEVELS);
    const log = new CraterLog().attach(world.terrain);
    for (const t of squads[0]) if (t.body) t.body.position.set(50, 0, 0);
    d.order('digin', d.commander, 0);
    step(d, DIG_SECONDS + 1);
    assert(world.craters.length === 1, 'nothing was dug');
    assert(log.length === 1,
      `the position left ${log.length} marks on the crater log — a scrape that does not go through `
      + '`crater` is a scrape the next engagement will not have');
    const e = log.entries;
    assert(e[2] === DIG_R && e[3] === DIG_DEPTH,
      `the log recorded a ${e[2]} m by ${e[3]} m hole rather than the position that was dug`);
    return `one position, one entry on the log: ${e[2]} m × ${e[3]} m, rim ${e[4]}`;
  });

  check('dig in: the order is an order, and it holds the ground it is given', () => {
    const F = FORMATIONS.digin;
    assert(F, 'there is no Dig in order at all');
    assert(F.digs === true, 'the Dig in order does not declare `digs`, so nothing runs the work');
    assert(F.advance === false,
      'Dig in advances with the general — a position you walk away from while it is being dug is '
      + 'not a position, and the anchor would move under the hole');
    assert(F.key, 'the order has no key, so `registerOrders` will not put it in the bindings table');
    /* The men have to end up UNDER the berm they are throwing up. */
    const out = new THREE.Vector3();
    let worst = 0;
    for (let i = 0; i < 8; i++) { F.slot(i, 8, 0, out); worst = Math.max(worst, Math.hypot(out.x, out.z)); }
    assert(worst < DIG_R * 0.62,
      `the furthest man stands ${worst.toFixed(1)} m from the middle of a ${DIG_R} m position, `
      + `whose berm is at ${(DIG_R * 0.9).toFixed(1)} m — a man outside it is standing on the parapet`);
    assert(DIG_WORK_R > DIG_R,
      `a man has to be inside ${DIG_WORK_R} m to be working on a ${DIG_R} m hole, which is smaller `
      + 'than the hole');
    return `${F.name} on ${F.key}: planted, digs, ${DIG_CREW}+ men, furthest slot ${worst.toFixed(1)} m in`;
  });

}

/* ── the fixture ──────────────────────────────────────────────────────── */

/** Step a director's troop pass for `seconds` at 1/30. */
function step(d, seconds) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) d._troops(1 / 30, {});
}

/**
 * A REAL `CommandDirector` OVER STUB BODIES, and a terrain that RECORDS being
 * dug rather than being dug.
 *
 * Same shape `objectives.mjs` uses and for the same reason: what is being
 * asked here is arithmetic over a rule table — how long, how many men, whose
 * ground — and none of it is a fact about a heightfield. The one question that
 * IS about a heightfield is the first check in this file, and it drives a real
 * world.
 */
async function armed(Cmd, LEVELS) {
  const craters = [];
  const world = {
    scene: new THREE.Scene(), settings: {}, level: LEVELS.geonosis, run: null,
    takenBoons: new Set(), statics: [], props: [], doors: [], report: () => {},
    difficulty: null, hpScale: 1, dmgScale: 1, players: [], enemies: [], craters,
    notify() {}, time: 0,
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {},
      addStaticBox() { return null; }, removeStaticBox() {}, raycast: () => null },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, surfaceAt: () => 'sand', flush() {}, slopeAt: () => 0,
      inBounds: () => true,
      crater(x, z, r, d, rim) { craters.push({ x, z, r, d, rim }); },
      scorch() {}, burn() {},
    },
  };
  let n = 0;
  world.spawnEnemy = (type, pos) => {
    const e = {
      id: 'b' + (++n), team: 0, dead: false, downed: false, position: pos.clone(),
      A: {}, type, world, speed: 4, hp: 100, maxHp: 100,
      velocity: new THREE.Vector3(), facing: 0, wish: null, toTarget: null,
      _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0, _prevPos: new THREE.Vector3(),
      attackDamage: 0, mod: null, rig: null, group: null,
      burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0, fireTimer: 0,
      _move() {}, _syncBody() {},
      damage(v) { this.hp -= v; return this.hp <= 0; },
    };
    world.enemies.push(e);
    return e;
  };
  const d = new Cmd.CommandDirector(world, { pool: LEVELS.geonosis.pool });
  d.lineAdvances = true;
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0 };
  world.players.push(me); world.player = me; d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  const squads = d.squadsOf(d.commander);
  if (squads.length < 2) throw new Error(`the fixture mustered ${squads.length} squad(s)`);
  return { world, d, squads };
}
