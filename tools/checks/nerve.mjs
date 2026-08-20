/**
 * BATTLEFRONT BORZ — NERVE: WHAT A SOLDIER DOES WHEN HE IS NOT FIGHTING.
 *
 * The player's words: "your allies shouldn't just freeze in place when they're
 * uninspired or whatever, it makes for looking bad, like maybe they should be
 * finding cover or still shooting idk you need to do something better but them
 * frozen still looks like a bug almost and it happens everywhere."
 *
 * It happened everywhere. Driven on Geonosis with a real World, a real army and
 * a fixed seed, the share of ALLIED BODY-FRAMES spent motionless, upright and
 * not firing — and the longest unbroken run of them on any one body:
 *
 *                          frozen   worst run
 *     circle                62.3%     17.5 s
 *     behind                63.2%     16.3 s
 *     cover                 62.6%     16.5 s
 *     holdfire              54.3%     19.1 s
 *     line                  20.5%     10.3 s
 *     front                 17.2%      6.1 s
 *     morale 0.15 (broken)  45.9%     12.2 s
 *     morale 0.05 (refuse) 100.0%     20.0 s      ← the whole window
 *
 * Three `return`s with nothing on the other side of them produced all of it and
 * `src/game/Command.js` names each one where it lives. What matters HERE is
 * what a check for this can and cannot be:
 *
 * IT MUST BE DRIVEN. Every number above is a property of ten real bodies with
 * real rigs standing on real ground under a real wave, and a stub roster cannot
 * have it — `command.mjs`'s fixtures deliberately carry only the fields the
 * director touches, and "does this man look like a person" is not one of them.
 * So this file boots Worlds, which is why it holds three and not nine.
 *
 * FROZEN IS UPRIGHT. A man kneeling behind a rock is still and that is the
 * point of a rock; a man standing to attention in the middle of a firefight is
 * the defect. So the classifier takes `crouch` — the rig float that
 * `CommandDirector.steer` is now the writer of — as the difference, and a body
 * only counts as frozen when it is motionless, silent AND on its feet.
 *
 * AND IT PRICES THE FIX. "Something better than frozen" is easy to buy by
 * making frightened men fight, which would be a worse game and a broken one.
 * The last two checks are the guard: a man below `REFUSE` fires nothing at all,
 * and a broken army does not out-shoot a steady one.
 */
import { clocked } from './_shared.mjs';

/** Slower than a stroll. Below this a body is standing, whatever it intended. */
const STILL = 0.35;
/** Past this a body is on a knee or on its face rather than on its feet. */
const DOWN = 0.5;
/** "For more than a moment", in seconds. A man may pause; he may not stop. */
const MOMENT = 1.5;

const DT = 1 / 30;
const WARM = 12;                                 // the gunships land, the wave opens

/**
 * A REAL WORLD ON A NAMED SEED.
 *
 * `runSeed` has to be on the world BEFORE `loadLevel`, because that is the call
 * that builds the director and the director is what seeds the streams off it.
 * Set afterwards it is a field nothing reads and the run is unseeded — measured,
 * the same condition then read `cover` at 1.5% and 62.6% frozen on two
 * consecutive runs of the same file.
 */
async function army(seed, mode = 'command', level = 'geonosis') {
  const { stubEngine } = await import('./_coop.mjs');
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../../src/game/Combat.js');
  await initPhysics();
  const engine = await stubEngine();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', mode };
  const world = new World(engine, s);
  world.runSeed = seed;
  world.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
  await world.loadLevel(level);
  world.spawnPlayer({ name: 'Jedi', isLocal: true });
  return world;
}

/**
 * Run one condition and classify every allied body on every frame.
 *
 * `morale` is forced BEFORE each step rather than once at the start, because
 * `_morale` runs every frame and a body standing next to its commander climbs
 * out of `BREAK` in about a second (`MORALE.JEDI_NEAR` is +0.085/s). Held, the
 * condition is the state the check says it is for the whole window.
 */
async function drive(world, { seconds, formation = null, morale = null }) {
  const { idleInput } = await import('./_coop.mjs');
  const d = world.command;
  const input = idleInput();
  d.start(1);
  for (let i = 0; i < WARM * 30; i++) world.update(DT, input);
  if (formation) d.order(formation, d.commander);
  const run = new Map(), flash = new Map();
  const o = { frames: 0, bodies: 0, still: 0, frozen: 0, longFrames: 0, worst: 0,
              shots: 0, crouchPeak: 0, animCrouch: 0, standoff: 0, standoffN: 0 };
  /* THE POSE IS READ WHERE THE RIG READS IT, not off the body. `steer` writing
   * a float nothing forwards would pass every other check in this file and ship
   * ten men standing bolt upright, which is the exact defect. So the animator's
   * own argument is recorded, once, through the shipped call. */
  for (const e of world.enemies) {
    if (!e.trooper || !e.animator || e.animator._nerveSpy) continue;
    const base = e.animator.update.bind(e.animator);
    e.animator._nerveSpy = true;
    e.animator.update = (dt, p) => { o.animCrouch = Math.max(o.animCrouch, p?.crouch || 0); return base(dt, p); };
  }
  for (let i = 0; i < seconds * 30; i++) {
    if (morale !== null) for (const t of d.roster.living) t.morale = morale;
    world.update(DT, input);
    for (const e of world.enemies) {
      if (!e || e.dead || !e.trooper) continue;
      o.bodies++;
      const moving = Math.hypot(e.velocity?.x || 0, e.velocity?.z || 0) >= STILL;
      const firing = (e.burstLeft > 0) || (e.aimCharge > 0) || (e.muzzleFlash > 0);
      const lit = (e.muzzleFlash || 0) > 0;
      if (lit && !flash.get(e.id)) o.shots++;
      flash.set(e.id, lit);
      o.crouchPeak = Math.max(o.crouchPeak, e.crouch || 0);
      if (!moving && !firing) o.still++;
      /* HOW FAR THIS MAN IS FROM THE NEAREST THING HE IS SUPPOSED TO BE
       * FIGHTING. It is the ground the line is holding, as one number, and it
       * is what breaking is meant to cost. */
      let near = Infinity;
      for (const h of world.enemies) {
        if (!h || h.dead || h.trooper) continue;
        const dx = h.position.x - e.position.x, dz = h.position.z - e.position.z;
        const q = dx * dx + dz * dz;
        if (q < near) near = q;
      }
      if (near < Infinity) { o.standoff += Math.sqrt(near); o.standoffN++; }
      const frozen = !moving && !firing && (e.crouch || 0) < DOWN;
      const r = frozen ? (run.get(e.id) || 0) + DT : 0;
      run.set(e.id, r);
      if (frozen) o.frozen++;
      if (r > o.worst) o.worst = r;
      if (r > MOMENT) o.longFrames++;
    }
    o.frames++;
  }
  o.pctFrozen = 100 * o.frozen / Math.max(1, o.bodies);
  o.pctLong = 100 * o.longFrames / Math.max(1, o.bodies);
  o.pctStill = 100 * o.still / Math.max(1, o.bodies);
  o.perBody = o.bodies / Math.max(1, o.frames);
  o.standoffM = o.standoff / Math.max(1, o.standoffN);
  return o;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* One World per condition and three conditions, held in this map so the
   * checks below can read each other's numbers — the last check is a
   * COMPARISON and rebuilding a fourth World to make it would double the cost
   * of the suite for a number already in hand. HANDOFF §2.7's warning about
   * suites holding several Worlds alive at once is why each one is disposed
   * the moment its numbers are out. */
  const M = {};
  async function once(key, opts) {
    if (M[key]) return M[key];
    const world = await army(20260820);
    try { M[key] = await drive(world, opts); } finally { world.dispose?.(); }
    return M[key];
  }

  await check('a refusing man goes to ground — he does not stop', async () => {
    const o = await once('refuse', { seconds: 14, morale: 0.05 });
    assert(o.perBody > 4, `only ${o.perBody.toFixed(1)} allied bodies on the field`);
    assert(o.pctFrozen < 10,
      `${o.pctFrozen.toFixed(1)}% of allied frames motionless, upright and silent (was 100.0%)`);
    assert(o.worst < MOMENT,
      `one body stood frozen for ${o.worst.toFixed(1)}s (was 20.0s — the whole window)`);
    return `${o.perBody.toFixed(1)} bodies · frozen ${o.pctFrozen.toFixed(1)}% · worst run ${o.worst.toFixed(1)}s`;
  });

  await check('…and it is the RIG that hears it, not just the director', async () => {
    const o = await once('refuse', { seconds: 14, morale: 0.05 });
    assert(o.crouchPeak > 0.6, `steer never took a body past crouch ${o.crouchPeak.toFixed(2)}`);
    assert(o.animCrouch > 0.6,
      `the animator was handed at most crouch ${o.animCrouch.toFixed(2)} — the pose is still a hard zero`);
    return `crouch reached ${o.crouchPeak.toFixed(2)} on the body and ${o.animCrouch.toFixed(2)} at the rig`;
  });

  await check('a broken man falls back, gets down, and keeps moving', async () => {
    const o = await once('broken', { seconds: 14, morale: 0.15 });
    assert(o.pctFrozen < 15,
      `${o.pctFrozen.toFixed(1)}% of a broken army's frames frozen (was 45.9%)`);
    assert(o.worst < MOMENT, `a broken body stood frozen for ${o.worst.toFixed(1)}s (was 12.2s)`);
    return `frozen ${o.pctFrozen.toFixed(1)}% · worst run ${o.worst.toFixed(1)}s`;
  });

  await check('a steady man at his post takes a knee rather than standing to attention', async () => {
    const o = await once('steady', { seconds: 14, formation: 'circle' });
    assert(o.pctStill > 20,
      `only ${o.pctStill.toFixed(1)}% of frames were still at all — this condition is not measuring what it claims`);
    assert(o.pctFrozen < 15,
      `${o.pctFrozen.toFixed(1)}% of a steady line's frames frozen upright (was 62.3%)`);
    assert(o.worst < MOMENT, `a man on his mark stood frozen for ${o.worst.toFixed(1)}s (was 17.5s)`);
    return `still ${o.pctStill.toFixed(1)}% of frames, of which frozen ${o.pctFrozen.toFixed(1)}% · worst ${o.worst.toFixed(1)}s`;
  });

  /**
   * THE PRICE. Both halves, because they fail in opposite directions.
   *
   * A man below `REFUSE` has always picked no target (`targetFor` returns null
   * on the same threshold) and giving him something to DO must not have given
   * him back his trigger. And a broken army that now runs, hides and scuttles
   * must not be OUT-FIGHTING the steady one it was carved out of — measured,
   * 72 shots against a steady circle's 45 and a pre-change broken army's 89, so
   * the bound is the steady line's rate with room for the noise in one wave.
   */
  /**
   * THE PRICE, AND IT IS MEASURED IN GROUND AND IN GUNS RATHER THAN IN KILLS.
   *
   * "Something better than frozen" is easy to buy by making frightened men
   * fight, which would be a worse game and a broken one. Kills would be the
   * obvious guard and are the wrong one: a fourteen-second window produces one
   * to three of them on either side of the change, which is a number that
   * cannot carry an assertion.
   *
   * What CAN: a man below `REFUSE` fires nothing at all — that has always been
   * `targetFor`'s answer on the same threshold and giving him something to DO
   * must not have handed his trigger back — and a broken army gives ground,
   * which is the whole content of "they should fall back when a position is
   * lost". The standoff is the mean distance from each living ally to the
   * nearest hostile: it is the ground the line is holding, as one number.
   */
  await check('breaking still costs the line its guns and its ground', async () => {
    const refuse = await once('refuse', { seconds: 14, morale: 0.05 });
    const broken = await once('broken', { seconds: 14, morale: 0.15 });
    const steady = await once('steady', { seconds: 14, formation: 'circle' });
    assert(refuse.shots === 0, `a refusing army fired ${refuse.shots} shots`);
    assert(broken.standoffM > steady.standoffM * 1.15,
      `a broken line stands ${broken.standoffM.toFixed(1)} m off the enemy and a steady one `
      + `${steady.standoffM.toFixed(1)} m — breaking gave up no ground at all`);
    return `refusing 0 shots · standoff steady ${steady.standoffM.toFixed(1)} m, `
      + `broken ${broken.standoffM.toFixed(1)} m, refusing ${refuse.standoffM.toFixed(1)} m`;
  });

  /**
   * …AND HE IS STILL A WORSE SHOT, which is the term that was already there and
   * is the reason the two checks above are allowed to let him shoot at all.
   * Read off `Enemy.aimQuality` rather than restated: it is a SPREAD multiplier,
   * so bigger is worse.
   */
  await check('a shaken man still cannot shoot straight', async () => {
    const { Enemy } = await import('../../src/game/Enemy.js');
    const e = Object.create(Enemy.prototype);
    e.A = { preferred: [8, 24], spread: 0.06 };
    e.world = null; e.dread = 0; e.velocity = { length: () => 0 }; e.speed = 4;
    const q = (m) => { e.trooper = { rank: 0, morale: m }; return e.aimQuality(20); };
    const steady = q(1), shaken = q(0.15);
    assert(shaken > steady * 1.3,
      `morale 0.15 costs a man only ${(shaken / steady).toFixed(2)}× on his spread`);
    return `spread ×${steady.toFixed(2)} steady, ×${shaken.toFixed(2)} at morale 0.15`;
  });
}
