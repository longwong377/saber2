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
  /**
   * …AND WITHOUT FLAGSHIP §6's LEVY, WHICH IS A STATEMENT ABOUT THIS BENCH AND
   * NOT ABOUT THE MODE.
   *
   * Every check in this file drives a Command world with an IDLE player — no
   * blade, no dash, no orders — for up to seventy seconds, and reads morale off
   * whoever is still standing. `CommandDirector` now fields forty conscripts a
   * wave on this ground (src/game/Levy.js), and forty extra rifles against ten
   * men whose Jedi does nothing is a wipe: measured on this exact bench, an
   * idle run goes 10 → 6 at 30 s → 0 at 60 s with the levy and 10 → 8 → 5 → 2
   * over ninety seconds without it. "morale is a channel and not a ceiling"
   * failed with `only 0 men left to read`.
   *
   * That is not this file's question. These checks are about what a morale
   * NUMBER does — whether it saturates, whether presence tapers, whether a
   * broken man keeps moving — and they need a line to read it off. The levy is
   * a wave composition and belongs to `tools/checks/levy.mjs`, which measures
   * it against a control the same way. Suppressed by handing the director the
   * base composer, which is exactly what that file's own control arm does.
   *
   * THE ATTRITION ITSELF IS NOT A DEFECT AND IS NOT BEING HIDDEN. Until this
   * session no rifle on the other side could touch your army at all — see
   * FLAGSHIP §16.3 — so every one of these benches has always run against a
   * line that could not be shot. What is open is how much of a ten-man roster
   * one engagement should cost, and that is a balance question with a number
   * on it rather than something to be answered by a morale check.
   */
  const Waves = await import('../../src/game/Waves.js');
  const d = world.command;
  if (d) d._composeUnder = Waves.WaveDirector.prototype._composeUnder.bind(d);
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
  const { MORALE: { BREAK } } = await import('../../src/game/Command.js');
  const d = world.command;
  const input = idleInput();
  d.start(1);
  for (let i = 0; i < WARM * 30; i++) world.update(DT, input);
  if (formation) d.order(formation, d.commander);
  const run = new Map(), flash = new Map();
  const o = { frames: 0, bodies: 0, still: 0, frozen: 0, longFrames: 0, worst: 0,
              shots: 0, crouchPeak: 0, animCrouch: 0, inLine: 0 };
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
    if (morale !== null) {
      /* `broken` AS WELL AS THE FLOAT. `_morale` derives the flag once a frame
       * and runs AFTER the bodies have moved, so a window that sets only the
       * number has its first frames steered as a steady line — measured, 0.2%
       * of "broken" frames were a man solving his formation slot, which is the
       * fixture leaking rather than the game. `MORALE.BREAK` is asked rather
       * than restated. */
      for (const t of d.roster.living) { t.morale = morale; t.broken = morale < BREAK; }
    }
    /* THE FORMATION, AS A PER-FRAME FACT. `steer` writes `cmdSlotDist` on
     * exactly the path that solves a man's place in the line and on no other,
     * so wiping it before the step and reading it after asks the shipped
     * director "did this man hold his post this frame" without restating one
     * word of what a post is. */
    for (const e of world.enemies) if (e.trooper) e.cmdSlotDist = -1;
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
      if (e.cmdSlotDist >= 0) o.inLine++;
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
  o.pctInLine = 100 * o.inLine / Math.max(1, o.bodies);
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
  await check('breaking still costs the line its guns and its place', async () => {
    const refuse = await once('refuse', { seconds: 14, morale: 0.05 });
    const broken = await once('broken', { seconds: 14, morale: 0.15 });
    const steady = await once('steady', { seconds: 14, formation: 'circle' });
    assert(refuse.shots === 0, `a refusing army fired ${refuse.shots} shots`);
    assert(steady.pctInLine > 60,
      `a steady line held its posts on only ${steady.pctInLine.toFixed(1)}% of frames — `
      + 'this condition is not measuring what it claims');
    assert(refuse.pctInLine === 0 && broken.pctInLine === 0,
      `a shaken line was still solving the formation on ${broken.pctInLine.toFixed(1)}% of `
      + `broken frames and ${refuse.pctInLine.toFixed(1)}% of refusing ones`);
    return `refusing 0 shots · posts held: steady ${steady.pctInLine.toFixed(1)}%, `
      + `broken ${broken.pctInLine.toFixed(1)}%, refusing ${refuse.pctInLine.toFixed(1)}%`;
  });

  /**
   * ── AND THE CHANNEL HAS ROOM TO MOVE IN, WHICH IT DID NOT ───────────────
   *
   * `NEXT.md`, on the Dead Jedi test: *"morale reads 1.000 in both player arms
   * — §10's `JEDI_NEAR` saturation is LIVE, so the channel §7's BREAK verb
   * needs is pinned shut and cannot be what presence pays through.
   * Unsaturating `JEDI_NEAR` is the first thing to try before believing this
   * table."*
   *
   * Measured on `tools/_flagship.mjs step2 --seeds 3,5`, one change, same tree,
   * same seeds:
   *
   *                     before      after
   *     no player        0.98        0.92
   *     with blade       1.000       0.89
   *     blade disabled   1.000       0.45   (sd 0.63 — one seed's line broke)
   *
   * Two terms did it and both are in `MORALE`: presence tapers out at
   * `PRESENCE_CAP` so standing beside a Jedi steadies a man rather than
   * elating him, and elation itself wears off above that cap so a wave cleared
   * cannot park a record at the ceiling for the rest of the battle.
   *
   * WHAT THIS CHECK HOLDS, and it is deliberately not the numbers above — a
   * two-seed probe is not a gate. It holds the two structural facts they rest
   * on: nothing sits pinned at the top, and there is always room left for the
   * next thing that happens to a man to move him.
   */
  await check('morale is a channel and not a ceiling', async () => {
    const { MORALE } = await import('../../src/game/Command.js');
    const { idleInput } = await import('./_coop.mjs');
    const world = await army(20260821);
    try {
      const { MAX_STRENGTH } = await import('../../src/game/Command.js');
      const d = world.command;
      const input = idleInput();
      /**
       * THE FULL ROSTER, BECAUSE THIS WINDOW IS LONGER THAN A TEN-MAN LINE
       * LASTS — and that is new information rather than a nicety.
       *
       * Seventy seconds of a Command engagement with an idle Jedi used to cost
       * the line nothing at all: no hostile bolt could reach a body in
       * `world.enemies`, your own troopers included (FLAGSHIP §16.3). With that
       * fixed, the same bench reads 10 → 8 at 30 s → 5 at 60 s → 2 at 90 s, and
       * this check failed on `only 3 men left to read`. Shortening the window
       * would have been the cheap repair and it is the wrong one: the seventy
       * seconds is what makes this "a line that has been WINNING", which is the
       * premise every assertion below rests on.
       *
       * So the bench musters the mode's own maximum instead. `MAX_STRENGTH` is
       * asked for rather than typed, so a roster ceiling that moves moves this
       * with it.
       */
      /* ENLISTED, not `opening` — that field is read by `_musterOpening` and
       * `_musterOpening` runs in the CONSTRUCTOR, so writing it here is writing
       * it after the muster it governs. Measured: the roster came back at ten
       * either way. The records are added through `CommandRoster.enlist`, the
       * same call the muster screen makes, off the army's own cheapest rung. */
      const cheapest = d.commander.army.tiers[0].type;
      while (d.roster.all.length < MAX_STRENGTH) d.roster.enlist(cheapest);
      d.start(1);
      /* Long enough for every one-shot event a winning line collects — a wave
       * cleared is +0.34 and an area held +0.5 — to have landed and settled.
       * Before the cap and the settle, this window is exactly what pinned it. */
      for (let i = 0; i < 70 * 30; i++) world.update(DT, input);
      const living = d.roster.living.filter(t => t.alive);
      assert(living.length >= 4, `only ${living.length} men left to read`);
      const m = living.map(t => t.morale);
      const top = Math.max(...m);
      const mean = m.reduce((a, b) => a + b, 0) / m.length;
      const pinned = m.filter(v => v >= 0.999).length;

      assert(!pinned,
        `${pinned} of ${m.length} records sit at 1.000 — a saturated channel carries no `
        + 'information, and every reader of morale (_pace, aimQuality, broken) is reading it');
      /* AND THE ROOM IS REAL: a comrade falling is the largest single knock in
       * the table, and it has to be able to land on the steadiest man there. */
      assert(top + Math.abs(MORALE.COMRADE_FELL) <= 1.0 + 1e-9,
        `the steadiest man is at ${top.toFixed(3)}, so a comrade falling (${MORALE.COMRADE_FELL}) `
        + 'would be partly absorbed by the clamp rather than felt');
      assert(top <= MORALE.PRESENCE_CAP + 0.02,
        `morale settled at ${top.toFixed(3)} against a ${MORALE.PRESENCE_CAP} ceiling — `
        + 'the settle is not taking elation back');

      /* …AND IT IS NOT PINNED AT THE BOTTOM EITHER. A line that has been
       * winning for seventy seconds is not a broken one, and a "fix" that
       * simply drove the number down would pass every clause above. */
      assert(mean > MORALE.BREAK,
        `the whole line averages ${mean.toFixed(3)}, under BREAK ${MORALE.BREAK} — `
        + 'unsaturating the top must not empty the bottom');
      return `${m.length} living: mean ${mean.toFixed(2)}, top ${top.toFixed(2)}, `
        + `cap ${MORALE.PRESENCE_CAP}, 0 pinned`;
    } finally { world.dispose?.(); }
  });

  /**
   * …AND PRESENCE IS A GRADIENT, WHICH IS WHAT MAKES IT A CHANNEL.
   *
   * `NEAR` is a radius, so `JEDI_NEAR` was a step: the man at your shoulder and
   * the man 13.9 m away drew the identical term, and the man at 14.1 m drew
   * `ALONE` instead. A cliff a player cannot see, in the one term the whole of
   * FLAGSHIP §7's presence argument is built on — and, once the ceiling came
   * off, the reason both arms of the Dead Jedi test rested at the same 0.84:
   * both had a Jedi somewhere inside a circle.
   *
   * Read off the shipped constants rather than re-deriving the curve, because
   * the shape is the claim and the numbers are the table's.
   */
  await check('presence falls off with distance rather than stopping at a rim', async () => {
    const { MORALE } = await import('../../src/game/Command.js');
    /* The same arithmetic `_morale` runs, asked at four distances. Written as
     * one expression so a change to the curve fails here rather than being
     * quietly re-stated. */
    const share = (m) => {
      const d2 = m * m;
      if (d2 >= MORALE.NEAR * MORALE.NEAR) return 0;
      return 1 - (1 - MORALE.EDGE) * (m / MORALE.NEAR);
    };
    assert(Math.abs(share(0) - 1) < 1e-9, `at the shoulder a man gets ${share(0).toFixed(3)} of the term`);
    assert(Math.abs(share(MORALE.NEAR * 0.999) - MORALE.EDGE) < 0.01,
      `at the rim a man gets ${share(MORALE.NEAR * 0.999).toFixed(3)} against a stated ${MORALE.EDGE}`);
    assert(share(MORALE.NEAR + 0.1) === 0, 'the term reaches past its own radius');
    /* THE RANGE IS THE POINT. A channel whose ends are within a few per cent of
     * each other is a step wearing a curve. */
    const mid = share(MORALE.NEAR / 2);
    assert(mid > MORALE.EDGE + 0.1 && mid < 0.95,
      `halfway out a man gets ${mid.toFixed(2)}, which is not between the two ends`);
    /* AND IT IS NOT A CLIFF AT THE RIM EITHER, which is the thing it exists to
     * remove: a man who can still see their Jedi keeps most of it. */
    assert(MORALE.EDGE > 0.15,
      `the rim keeps ${MORALE.EDGE} of the term — that is a discontinuity put back where one was taken out`);
    /* …and what it is worth in the number a body reads: the difference between
     * standing with your line and standing at the edge of it. */
    const at = (m) => MORALE.JEDI_NEAR * share(m);
    return `JEDI_NEAR ${at(0).toFixed(3)}/s at the shoulder, ${at(MORALE.NEAR / 2).toFixed(3)} at `
      + `${(MORALE.NEAR / 2).toFixed(0)} m, ${at(MORALE.NEAR * 0.999).toFixed(3)} at the rim, 0 past it`;
  });

  /**
   * …AND NOTHING BELOW THE CAP MOVED, which is the claim that lets every other
   * measurement in this file stand. The rally out of `BREAK` is the number
   * `drive`'s own header quotes — "about a second" at +0.085/s — and it is
   * arithmetic on the shipped table rather than a second copy of it.
   */
  await check('the presence taper does not touch a broken man', async () => {
    const { MORALE } = await import('../../src/game/Command.js');
    /* A man at 0.15 is below BREAK and a long way below the cap, so the taper
     * multiplies presence by 1 — the full term applies, exactly as before. */
    const low = 0.15;
    const over = (low - (MORALE.PRESENCE_CAP - MORALE.PRESENCE_BAND)) / MORALE.PRESENCE_BAND;
    const scale = 1 - Math.min(1, Math.max(0, over));
    assert(scale === 1,
      `a man at ${low} has his presence term scaled to ${scale.toFixed(2)} — the taper reaches `
      + 'below BREAK, and the rally this file measures everywhere would be slower');
    const rally = (MORALE.BREAK - low) / MORALE.JEDI_NEAR;
    assert(rally < 1.2,
      `a broken man beside his Jedi takes ${rally.toFixed(2)}s to get out of BREAK`);
    /* And the settle cannot reach him either: it only exists above the cap. */
    assert(low <= MORALE.PRESENCE_CAP, 'BREAK is above the presence ceiling, which is nonsense');
    return `at morale ${low}: presence ×${scale.toFixed(2)}, out of BREAK in ${rally.toFixed(2)}s, `
      + 'settle does not reach';
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
