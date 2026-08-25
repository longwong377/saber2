/**
 * BATTLEFRONT BORZ — does a retreat look like a person giving ground?
 *
 * The report was "the enemies back away really quickly and awkwardly as you
 * approach them — it's almost unnatural even when you approach them at speed."
 * The retreat itself is wanted; what was wrong was that it ran at full forward
 * speed, pointed straight back down the line the player came in on, and flipped
 * through 180 degrees on the single frame the player crossed the inner
 * preferred range. Three separate tells, none of which would fail a reading.
 *
 * ── AND THE OTHER HALF OF MOVING: GETTING PAST THINGS ────────────────────
 *
 * `Enemy._move` is also this game's whole navigation — a SLIDE that strips the
 * into-a-face component off the wish, and a COMMIT that swings the wish to one
 * side once the body has wanted to move and not moved for half a second. Both
 * are cheap on purpose and neither is a path-finder, so the property worth
 * binding is not "it finds the best way round"; it is that A BODY ORDERED
 * THROUGH A ROCK ENDS UP PAST THE ROCK — or out of the corner two rocks make —
 * and that it never ends up inside one.
 *
 * The checks below drive the shipped `_move` at a real static box in a real
 * Rapier world, the way `giants.mjs` drives it at a real bank. They exist
 * because that property was false on the shipped Geonosis: see the note on the
 * latched wall side in `Enemy._move`, and the two arms of the first check,
 * which differ only in the value of `strafeDir` — a field the outcome must not
 * depend on.
 */

import * as THREE from 'three';
import { limitBackpedal, ARCHETYPES, enemyRng } from '../../src/game/Enemy.js';
import { SaberController } from '../../src/game/SaberController.js';
import { smoothstep } from '../../src/engine/MathUtil.js';
import { STEP_UP } from '../../src/physics/Support.js';
import { FORM_TOLERANCE } from '../../src/game/Command.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert }) {
  /**
   * THE ARMY HAS TO BE THE SAME ARMY. The Geonosis march below boots a real
   * World, and `Enemy.js`'s `enemyRng` and `Command.js`'s `commandRng` are
   * module-scope streams: a suite that left their phase where the last one
   * finished musters a different army, at different speeds, standing in
   * different places. `clocked` is the one call that puts all of them back —
   * see `_shared.mjs`, and the note in `suppression.mjs` for what it costs not
   * to. The pure checks above it neither draw nor care.
   */
  check = await clocked(check);

  check('retreat: giving ground is slower than taking it', () => {
    const toTarget = V(0, 0, -1);                 // target lies down -Z
    const speed = 4.1;                            // a clone trooper
    const back = limitBackpedal(V(0, 0, speed), toTarget);   // straight retreat
    const fwd = limitBackpedal(V(0, 0, -speed), toTarget);   // straight advance
    const ratio = back.length() / fwd.length();
    assert(Math.abs(fwd.length() - speed) < 1e-6,
      `an advance was slowed to ${fwd.length().toFixed(2)} of ${speed} — only the retreat should be`);
    assert(ratio > 0.3 && ratio < 0.75,
      `backpedal is ${(ratio * 100).toFixed(0)}% of forward speed; a body does roughly half`);
    return `retreat ${back.length().toFixed(2)} m/s vs advance ${fwd.length().toFixed(2)} m/s (${(ratio * 100).toFixed(0)}%)`;
  });

  check('retreat: a sidestep keeps its full pace', () => {
    const toTarget = V(0, 0, -1);
    const speed = 4.1;
    const side = limitBackpedal(V(speed, 0, 0), toTarget);
    assert(Math.abs(side.length() - speed) < 1e-6,
      `a pure sidestep was slowed to ${side.length().toFixed(3)} of ${speed}`);
    // and a diagonal retreat should lose only its away component
    const diag = limitBackpedal(V(3, 0, 3), toTarget);
    assert(Math.abs(diag.x - 3) < 1e-6, `the lateral part of a diagonal retreat moved: ${diag.x.toFixed(3)}`);
    assert(Math.abs(diag.z - 1.5) < 1e-6, `the away part should halve to 1.5, got ${diag.z.toFixed(3)}`);
    return 'lateral untouched, away halved';
  });

  check('retreat: the yield eases in over a band instead of snapping', () => {
    // This mirrors the blend in Enemy._brain: yieldAmt ramps across the inner
    // half of the preferred range rather than switching at a threshold.
    const [near] = ARCHETYPES.trooper.preferred;
    const at = (d) => smoothstep(near, near * 0.55, d);
    assert(at(near * 1.05) === 0, 'the enemy is already yielding outside its preferred range');
    assert(at(near * 0.5) === 1, 'the enemy never fully yields even well inside');
    // the whole point: no single step across the band moves it very far
    let worst = 0, prev = at(near * 1.1);
    for (let d = near * 1.1; d > near * 0.5; d -= 0.02) {
      const v = at(d);
      worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    // 2 cm of approach is about one frame at a sprint; a hard threshold would
    // show a full 1.0 step here, which is exactly what the old code did.
    assert(worst < 0.15,
      `the yield jumps ${worst.toFixed(2)} in 2 cm of approach — that is a threshold, not a band`);
    return `ramps over ${(near * 0.45).toFixed(2)} m, worst step ${worst.toFixed(3)}`;
  });

  check('retreat: every archetype has room to yield inside its preferred range', () => {
    const rows = [];
    for (const [key, A] of Object.entries(ARCHETYPES)) {
      if (A.inert || !A.preferred) continue;
      const [near, far] = A.preferred;
      if (near === 0 && far === 0) continue;      // training dummies stand still
      assert(far > near, `${key} has preferred [${near}, ${far}] — inverted`);
      // the band the blend ramps across has to be wide enough to be felt
      assert(near * 0.45 > 0.35 || A.melee,
        `${key} yields across only ${(near * 0.45).toFixed(2)} m, which is one frame at a run`);
      rows.push(`${key} ${near}-${far}`);
    }
    return `${rows.length} archetypes`;
  });

  /* ── and getting past what is in the way ──────────────────────────── */

  check('navigation: a man ordered past a rock gets round it, whichever side he picks', async () => {
    /**
     * THE TWO ARMS DIFFER BY `strafeDir` AND BY NOTHING ELSE, and that is the
     * decision this check is about.
     *
     * `strafeDir` is a coin the constructor tosses per body and `_think`
     * re-tosses every 1.1-3.3 s. It picks which way the COMMIT term swings,
     * which is fine — either way round a rock is a way round a rock. What it
     * must NOT do is decide whether the body gets round the rock AT ALL, and
     * until the side was latched in `_move`'s slide it did exactly that. On
     * this fixture, which is the real rock at its real angle with the real body
     * standing where the real march left him:
     *
     *     strafeDir  +1     round in 1.8 s
     *     strafeDir  -1     NEVER — ten seconds pressed against the face for
     *                       0.4 m of net ground, ending at (-2.21, 2.18),
     *                       which is CT-3208's own spot to a decimetre
     *
     * The cause is in `_move` and the note there carries it: `strafeDir`'s
     * lateral and the slide's own leftover tangent lie along the same face and
     * nothing made them lie along it the same way, and the leftover sat right
     * on the cut between them — so the body took one on one frame and the other
     * on the next, fifty-two times over nine seconds. On the shipped Geonosis
     * that was 4 of 54 men over six ordered 35 m moves, every one against this
     * rock, each of them counted out of place by `Command.lineGathered` — the
     * quorum half the game's ground-taking hangs on — for the rest of the
     * battle.
     *
     * ARRIVAL IS THE BOUND, not the route: this is a slide and a commit, not a
     * path-finder, and either side of the rock is a correct answer.
     */
    const a = await roundTheRock(1);
    const b = await roundTheRock(-1);
    for (const r of [a, b]) {
      assert(r.touched,
        `with strafeDir ${r.strafeDir} the body never touched the rock at all (closest `
        + `${r.closest.toFixed(2)} m) — it walked round a thing it never met, so nothing below `
        + 'this line is a statement about the slide');
      assert(r.arrived,
        `with strafeDir ${r.strafeDir} the body ordered past the rock was still ${r.short.toFixed(1)} m `
        + `short of clearing it after ${r.seconds.toFixed(1)} s, having covered ${r.net.toFixed(1)} m of `
        + 'net ground. Which way round is its own business; getting round is not');
    }
    /* AND THE TWO ARMS COST ABOUT THE SAME. A body that clears the rock only
     * because it took the long way is still fighting the face on the way; the
     * ratio is what says the coin no longer decides anything that matters.
     * Measured across six starting spots around this rock the worst ratio is
     * 1.63 and this one is 1.26, against 5.3-5.9 on the broken build — where
     * four of those six never cleared the rock at all on strafeDir -1, which is
     * what an unbounded ratio actually looks like. */
    const ratio = Math.max(a.seconds, b.seconds) / Math.min(a.seconds, b.seconds);
    assert(ratio < 2,
      `one side of the rock took ${a.seconds.toFixed(1)} s and the other ${b.seconds.toFixed(1)} s — `
      + `${ratio.toFixed(1)}x. Both ways round one rock are one walk, so a gap that size is one arm `
      + 'fighting the face rather than sliding along it');
    return `strafeDir +1 round in ${a.seconds.toFixed(1)} s (${a.net.toFixed(1)} m) · `
      + `-1 in ${b.seconds.toFixed(1)} s (${b.net.toFixed(1)} m)`;
  });

  check('navigation: …and neither of them ever gets inside the rock', async () => {
    /**
     * THE OTHER HALF, AND WITHOUT IT THE FIRST ONE IS SATISFIED BY DELETING THE
     * COLLISION. Every frame of both arms is asked whether the body's chest is
     * inside the box, in the box's own frame — the same transform
     * `_pushOutOfBoxes` resolves a contact with, asked as a question instead —
     * so a body that got round by walking through fails here, and so does one
     * that got a shoulder in and stayed.
     *
     * The rock stands taller than `STEP_UP` above the ground it is bedded in,
     * which is what makes it a wall rather than a kerb: `_move`'s climb branch
     * refuses anything more than a step above the floor, so nothing in either
     * arm is allowed to go over it either.
     */
    for (const dir of [1, -1]) {
      const r = await roundTheRock(dir);
      assert(r.exposed > STEP_UP,
        `the rock stands ${r.exposed.toFixed(2)} m out of the ground against a ${STEP_UP} m step — `
        + 'a body would simply walk over it and this check would measure nothing');
      assert(r.deepest <= 0,
        `with strafeDir ${dir} the body was ${r.deepest.toFixed(3)} m inside the rock at `
        + `(${r.deepestAt}) — the way round must not be through`);
      assert(r.overTop === 0,
        `with strafeDir ${dir} the body stood on top of the rock for ${r.overTop} frames`);
    }
    const r = await roundTheRock(1);
    return `rock stands ${r.exposed.toFixed(2)} m proud · both arms stay ${(-r.deepest).toFixed(2)} m `
      + 'clear of its nearest face, never on top';
  });

  check('navigation: and committing to a side is not itself a trap — a body walks out of a corner', async () => {
    /**
     * THE OBVIOUS WAY TO BREAK A LATCHED SIDE, ASKED AS A CHECK.
     *
     * Holding one side for the length of a contact is a commitment, and the
     * shape that punishes a commitment is a CONCAVE one: the side a body takes
     * off the first face is the wrong way round the second. `outOfCorner` builds
     * that out of two copies of the same Geonosis rock meeting at a vertex, and
     * drives the body straight through it.
     *
     * It comes out the other way from the worry. On the shipped build both arms
     * stood in the vertex at (±0.4, 3.1) for the whole twenty seconds — a
     * per-frame side does not need a rotated face to alternate, two faces will
     * do — and with the side latched both are out in 4.8 s. So this is not a
     * regression guard that happens to pass; it is a second wedge the same fix
     * clears, on geometry the level dresses with by the hundred.
     */
    for (const dir of [1, -1]) {
      const r = await outOfCorner(dir);
      assert(r.touched, `with strafeDir ${dir} the body never met the corner at all`);
      assert(r.escaped,
        `with strafeDir ${dir} the body ordered through a corner was still in it at (${r.at}) after `
        + `${r.seconds.toFixed(1)} s — a side held against one face must not be a side held into a `
        + 'vertex');
      assert(r.deepest <= 0,
        `with strafeDir ${dir} the body was ${r.deepest.toFixed(3)} m inside the corner — the way out `
        + 'must not be through');
    }
    const a = await outOfCorner(1), b = await outOfCorner(-1);
    return `out of the vertex in ${a.seconds.toFixed(1)} s / ${b.seconds.toFixed(1)} s, `
      + `both arms staying ${(-Math.max(a.deepest, b.deepest)).toFixed(2)} m clear of both faces`;
  });

  check('navigation: and a line ordered 35 m across the shipped Geonosis arrives with nobody left on a rock', async () => {
    /**
     * THE SAME PROPERTY, ON GROUND NOBODY BUILT FOR IT — and this is the arm
     * that found the defect. `suppression.mjs` walks a Jedi 35 m with ten men
     * ordered to follow and reports how far the line ends up strung out; that
     * reading was 35-40 m, and all of it was ONE MAN standing against ONE ROCK
     * for the whole march. The median man was 9.8 m from the anchor and the
     * furthest was 34.9.
     *
     * WEDGED, as a fact about ground covered rather than about velocity: a body
     * more than `FORM_TOLERANCE` from the slot it was told to stand in — so it
     * WANTS to be elsewhere — whose net displacement over three seconds is less
     * than that same tolerance. Three seconds because the navigation's own
     * commit clock swings a body to one side at half a second and tries the
     * other way at two and a half, so anything shorter counts a body that is
     * merely going the long way round; and the tolerance because a man who
     * covers less in three seconds than the slack his own formation already
     * allows him has not walked anywhere. The velocity is deliberately not in
     * the test: all four men it caught read 0.7-6.0 m/s the whole time they
     * were going nowhere, so a check that watched speed would have passed.
     *
     *     before   this arm: 1 of 8, CT-3208 pinned at (-3.8, 3.2) for 6.2 s.
     *              Over the six arms of `tools/_wedge.mjs`: 4 of 54, every one
     *              against the box centred at (-1.78, 4.23) — the nearest of
     *              the level's 233 static boxes to all four, at 2.2-2.6 m, the
     *              next being 20 m off — for 4.3-6.5 s each, at 0.7-6.0 m/s.
     *              Furthest living man from the anchor 34.8-35.8 m.
     *     after    this arm: 0 of 8, furthest 12.0 m. Six arms: 0 of 54,
     *              furthest 12.0-14.2 m.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const idle = idleInput();
    const forward = { ...idle, keys: new Set(), buttons: [false, false, false],
      moveAxis: (o) => (o ? (o.x = 0, o.y = 1, o) : { x: 0, y: 1 }) };
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed: 7, difficulty: 'knight' },
    });
    try {
      const d = world.command, p = world.player;
      /* `start(1)` IS WHAT PUTS THE LINE ON THE GROUND — the roster exists
       * without it and no body does. The spawn queue is then emptied: this
       * measures the WALK, and a fight would put reactions, cover and
       * casualties between the rule and the reading. */
      world.director.start(1);
      d.spawnQueue.length = 0;
      for (let i = 0; i < 60; i++) world.update(DT, idle);
      const men = d.commander.roster.living.map((t) => t.body).filter(Boolean);
      assert(men.length > 5, `the fixture stood up ${men.length} men`);

      const STALL = 3;                                  // seconds; see above
      const WIN = Math.round(STALL / DT);
      const trail = new Map(men.map((e) => [e, []]));
      const stuck = new Map(men.map((e) => [e, { run: 0, best: 0, at: null }]));
      const from = p.position.clone();
      let frames = 0;
      for (let i = 0; i < 900; i++) {
        world.update(DT, forward);
        frames++;
        for (const e of men) {
          if (e.dead) continue;
          const h = trail.get(e), w = stuck.get(e);
          h.push([e.position.x, e.position.z, (e.cmdSlotDist ?? 0) > FORM_TOLERANCE]);
          if (h.length > WIN) h.shift();
          const full = h.length === WIN && h.every((r) => r[2]);
          const net = full ? Math.hypot(h[WIN - 1][0] - h[0][0], h[WIN - 1][1] - h[0][1]) : Infinity;
          if (net < FORM_TOLERANCE) {
            if (++w.run > w.best) { w.best = w.run; w.at = `${e.position.x.toFixed(1)}, ${e.position.z.toFixed(1)}`; }
          } else w.run = 0;
        }
        if (p.position.distanceTo(from) >= 35) break;
      }
      const walked = p.position.distanceTo(from);
      assert(walked > 30, `the commander only walked ${walked.toFixed(1)} m, so nothing was measured`);
      const wedged = men.filter((e) => !e.dead && stuck.get(e).best > 0);
      const anchor = d.commander._paceAnchor || p.position;
      let worst = 0, standing = 0;
      for (const e of men) {
        if (e.dead) continue;
        standing++;
        worst = Math.max(worst, Math.hypot(e.position.x - anchor.x, e.position.z - anchor.z));
      }
      assert(wedged.length === 0,
        `${wedged.length} of ${standing} men spent the march wedged on level geometry — `
        + wedged.map((e) => `${e.trooper?.name} at (${stuck.get(e).at}) for `
          + `${((stuck.get(e).best + WIN) * DT).toFixed(1)} s`).join('; ')
        + '. A man who cannot get round a rock never rejoins the line, and `lineGathered` counts '
        + 'him out of place for the rest of the battle');
      /* AND THE LINE IS ACTUALLY TOGETHER, which is the reading the wedge was
       * corrupting. Not a tuned bound: a man who is walking is somewhere near
       * the anchor, and one who is not is 35 m behind it. */
      assert(worst < walked * 0.6,
        `the line walked ${walked.toFixed(1)} m and its furthest living man ended `
        + `${worst.toFixed(1)} m from the anchor — that is a man who never came`);
      return `${standing} men, ${walked.toFixed(0)} m in ${frames} frames · none wedged · `
        + `furthest ${worst.toFixed(1)} m from the anchor`;
    } finally { world.unload?.(); }
  });

  /* ── the blade cursor itself ───────────────────────────────────────── */

  check('blade: a pixel of mouse means the same angle whichever way you push it', () => {
    // gx and gy are each in units of their OWN maximum, and those maxima differ
    // (yaw 1.62 rad, pitch 1.28). Sharing one gain made sideways travel 1.27x
    // faster in ANGLE than vertical, so a straight overhead pull curved off to
    // the side and diagonals never went where they were aimed.
    const c = new SaberController();
    const PX = 100;
    c.gx = 0; c.gy = 0;
    const fake = (dx, dy) => ({
      mouse: { dx, dy, wheel: 0, down: true },
      accel: { x: 0, y: 0 },
      act: (id) => id === 'blade',
      actHit: () => false,
    });
    c.applyInput(fake(PX, 0), 1 / 60, {});
    const yawDeg = Math.abs(c.gx * c.maxYaw) * 180 / Math.PI;
    c.gx = 0; c.gy = 0;
    c.applyInput(fake(0, -PX), 1 / 60, {});
    const pitchDeg = Math.abs(c.gy * c.maxPitch) * 180 / Math.PI;
    const ratio = yawDeg / pitchDeg;
    assert(Math.abs(ratio - 1) < 0.02,
      `${PX} px gives ${yawDeg.toFixed(1)} deg of yaw but ${pitchDeg.toFixed(1)} deg of pitch (${ratio.toFixed(2)}x) — an overhead will curve`);
    return `${PX} px -> ${yawDeg.toFixed(1)} deg either way`;
  });

  check('blade: the guard rests near the middle of the screen, not above it', () => {
    const c = new SaberController();
    const upDeg = c.readyY * c.maxPitch * 180 / Math.PI;
    const rightDeg = c.readyX * c.maxYaw * 180 / Math.PI;
    // At 0.30 this rested 22 degrees high, so every deflection began by dragging
    // back down to centre before you could start aiming.
    assert(upDeg < 10,
      `the blade cursor rests ${upDeg.toFixed(0)} deg above centre — that is a handicap, not a guard`);
    return `rests ${rightDeg.toFixed(0)} deg right, ${upDeg.toFixed(0)} deg up`;
  });
}

/* ── one body, one rock, one place to be on the far side ──────────────── */

/** The step every fixture below drives `_move` at, and the point on a body
 *  every collision question in this file is asked about — its chest, which is
 *  the height `_pushOutOfBoxes` resolves a body against. Both are written once
 *  because the two rock fixtures and the Geonosis march all use them. */
const DT = 1 / 30;
const CHEST = 0.9;

/**
 * FLAT GROUND, IN BOUNDS EVERYWHERE — the same stub `giants.mjs`, `vehicles.mjs`
 * and `beasts.mjs` stand their subjects on. What is being asked here is about
 * the body and the box; a real heightfield would make every number depend on
 * where the probe happened to stand.
 */
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

const particles = {
  sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
  spatter() {}, plasma: { spawn() {} }, smoke: { spawn() {} },
};

/**
 * THE ROCK, AND IT IS THE GEONOSIS ONE — POSE AND ALL.
 *
 * Every number here is READ OFF the shipped level rather than chosen: the box
 * `LEVELS.geonosis` dresses its deploy ground with, centred at (-1.78, 4.23)
 * with half extents (1.53, 1.64, 1.41) and that quaternion, its centre 0.15 m
 * below the sand around it — 1.97 m of turned rock proud of flat ground, which
 * is a wall by any measure a man can take. Of the level's 233 static boxes it
 * is the nearest to all four wedges the census found, at 2.2-2.6 m; the next
 * nearest to any of them is 20 m away.
 *
 * THE ROTATION IS LOAD-BEARING AND THAT IS THE FINDING. That quaternion yaws
 * the box -165 degrees and TILTS it 14, so the face a man walking up +Z meets
 * is fifteen degrees off square to him — which is exactly where the leftover
 * tangent is small enough to sit on `SLIDE_TANGENT`, the cut the latch switches
 * at, and small enough for its sign to be noise. An axis-aligned box in the
 * same place does not reproduce it, and that is measured: over six starting
 * spots around this rock, FOUR wedge forever on strafeDir -1 against the box at
 * this pose and NONE do against an unrotated box of the same extents in the
 * same place. A face dead square to the march leaves a leftover reliably UNDER
 * the cut, so the old code took the `strafeDir` perpendicular every frame —
 * which at least has a consistent sign — and slid off one way. The tilt is also
 * why the "inside the rock" test below has to be all three axes.
 *
 * `WEDGED_AT` is where CT-3208 was standing when the shipped march left him
 * behind, and `SLOT` is the bearing his slot walked off on. So the fixture is
 * the real body, on the real rock, at the real angle.
 */
const ROCK = {
  half: [1.53, 1.64, 1.41],
  quat: [0.05, 0.98, -0.13, -0.12],
  at: [-1.78, 4.23],
  /* The box centre's height ABOVE THE GROUND IT STANDS IN, which is the shipped
   * record's own -0.80 against `terrain.height(-1.78, 4.23)` of -0.65. Bedding
   * by anything else — "stand 1.47 m of it proud", which is the same rock's
   * derived height — moves the whole box down by the difference between its
   * local Y half and its turned reach, and 15 cm is the difference between a
   * chest that is nearest the SIDE of this rock and one that is nearest its
   * TOP. `_pushOutOfBoxes` leaves upward faces to the support query, so those
   * are not the same rock at all. */
  centreY: -0.15,
};
const WEDGED_AT = [-2.6, 2.25];
const SLOT = [0, 40];

let _phys = null;
async function physics() {
  if (_phys) return _phys;
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
  await initPhysics();
  return (_phys = { RapierWorld });
}

/**
 * THE SMALLEST WORLD `Enemy._move` WILL RUN IN, and the same one twice: the rock
 * fixture and the corner fixture below differ only in what boxes they put in it
 * and where they stand the body, so the stub is written once. `enemyRng` is
 * seeded here because building a body draws from it and `determinism.mjs` holds
 * every suite to a fixed stream.
 */
async function stubWorld() {
  const { RapierWorld } = await physics();
  enemyRng.seed(4711);
  const terrain = flat();
  const w = {
    scene: new THREE.Scene(),
    physics: new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 32 }),
    terrain, statics: [], settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [], particles,
    bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xa9764a, difficulty: null,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, addHitstop() {}, notifyFloating() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  w.physics.terrain = terrain;
  return w;
}

/**
 * ONE BODY, STOOD WHERE IT IS TOLD, WISHING TOWARDS A SLOT — and nothing else
 * touching it: no brain, no formation, no target, so the only thing steering is
 * the navigation in `_move`. `strafeDir` is written by hand because it is the
 * input under test and a coin toss is not an arm.
 */
function loneBody(Enemy, w, at, strafeDir) {
  const e = new Enemy(w, 'trooper', new THREE.Vector3(at[0], 0, at[1]));
  w.enemies.push(e);
  e.position.set(at[0], 0, at[1]);
  e.velocity.set(0, 0, 0);
  e.grounded = true;
  e.toTarget = null;
  e.strafeDir = strafeDir;
  e._stuckT = 0; e._wallT = 0; e._wallN.set(0, 0, 0);
  e._prevPos.copy(e.position);
  return e;
}

/** How deep inside a static box a point is, POSITIVE INSIDE, in the box's own
 *  frame — the same transform `_pushOutOfBoxes` resolves a contact with, asked
 *  as a question instead. ALL THREE AXES: an x/z-only test against a box that is
 *  TILTED as well as turned is a test against an infinite prism along the box's
 *  own leaning Y, and it reports a body standing beside the Geonosis rock as
 *  0.80 m inside it. */
const _lp = new THREE.Vector3();
function depthIn(box, half, p) {
  _lp.copy(p).sub(box.center).applyQuaternion(box.invQuat);
  return Math.min(half.x - Math.abs(_lp.x), half.y - Math.abs(_lp.y), half.z - Math.abs(_lp.z));
}

/**
 * ONE ORDERED MOVE PAST THE ROCK, DRIVEN THROUGH THE SHIPPED `_move`.
 *
 * The wish is re-solved every frame from where the body is now to where it was
 * told to be, which is exactly what `CommandDirector.steer` writes into `wish`
 * one line before `_move` reads it (see `installCommand`) — and re-solving it is
 * load-bearing rather than tidy: the defect this fixture exists for is a
 * decision that flips as the APPROACH ANGLE wobbles, and a wish nailed to a
 * constant direction never wobbles.
 *
 * Memoised: both checks above want both arms, and one arm is 300 frames of real
 * Rapier.
 */
const _round = new Map();
async function roundTheRock(strafeDir) {
  if (_round.has(strafeDir)) return _round.get(strafeDir);
  const { Enemy } = await import('../../src/game/Enemy.js');
  const w = await stubWorld();
  const terrain = w.terrain;

  const half = new THREE.Vector3(...ROCK.half);
  const quat = new THREE.Quaternion(...ROCK.quat).normalize();
  /* HOW FAR THE TURNED BOX REACHES ABOVE ITS OWN CENTRE — off its eight real
   * corners, because `halfExtents.y` is the height of the box and not of the
   * box AS IT SITS. Bedding by the wrong one buries or floats the rock, and the
   * whole question is whether a man can get round something he cannot step
   * over. */
  const corner = new THREE.Vector3();
  let lift = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corner.set(sx * half.x, sy * half.y, sz * half.z).applyQuaternion(quat);
    lift = Math.max(lift, corner.y);
  }
  const centre = new THREE.Vector3(ROCK.at[0], ROCK.centreY, ROCK.at[1]);
  const box = w.physics.addStaticBox(centre, half, quat);
  const top = centre.y + lift;

  const e = loneBody(Enemy, w, WEDGED_AT, strafeDir);

  const ctx = { enemies: w.enemies, particles, terrain, physics: w.physics,
    bolts: w.bolts, time: 0, camera: w.engine.camera };
  const goal = new THREE.Vector3(SLOT[0], 0, SLOT[1]);
  const start = e.position.clone();
  /* PAST THE ROCK is the whole question, so the finish line is the rock's own
   * reach and not a distance somebody picked. */
  const clear = centre.z + box.radius;
  /* Ten seconds. The wedge this exists for ran for the whole 7.7 s of the march
   * it was on, and every arm that gets round does it inside three. */
  const frames = Math.round(10 / DT);
  const chest = new THREE.Vector3();
  let touched = false, closest = Infinity, deepest = -Infinity, deepestAt = '', overTop = 0, used = frames;
  let arrived = false;
  for (let i = 0; i < frames; i++) {
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(goal.x - e.position.x, 0, goal.z - e.position.z).normalize();
    e._move(DT, ctx);
    if (e._wallT > 0) touched = true;
    chest.set(e.position.x, e.position.y + CHEST, e.position.z);
    closest = Math.min(closest, chest.distanceTo(box.center));
    /* Positive is inside; a body the sweep has put out sits its own radius
     * clear of the nearest face. See `depthIn`. */
    const in3 = depthIn(box, half, chest);
    if (in3 > deepest) { deepest = in3; deepestAt = `${e.position.x.toFixed(2)}, ${e.position.z.toFixed(2)}`; }
    if (e.position.y > top - 0.05) overTop++;
    if (e.position.z > clear) { used = i + 1; arrived = true; break; }
  }
  const r = {
    strafeDir, touched, closest, deepest, deepestAt, overTop,
    exposed: top - terrain.height(),
    arrived, short: Math.max(0, clear - e.position.z), seconds: used * DT,
    net: e.position.distanceTo(start),
  };
  e.dispose?.();
  _round.set(strafeDir, r);
  return r;
}

/* ── and the corner the latch could have made ─────────────────────────── */

/**
 * TWO COPIES OF THAT SAME ROCK, SET AT RIGHT ANGLES, POINT AT THE BODY.
 *
 * A latched side is a commitment, and the obvious way to break one is a shape
 * where the side a body picks on the first face is the WRONG way round the
 * second. So: the same box as above, mirrored, meeting at a vertex the body is
 * ordered straight through. Every number is the box's own — `REACH` is how far
 * a `ROCK.half` box yawed 45 degrees puts its corner along X, so placing the
 * two centres at ±REACH is what makes their inner corners MEET rather than
 * leaving a gap to walk through, and the escape line is three of those out.
 *
 * The finding is the other way round from the worry. On the shipped build BOTH
 * arms sat in the vertex at (±0.4, 3.1) for the whole twenty seconds — the
 * alternation does not need a rotated face, only two faces — and with the side
 * latched both arms are out in 4.8 s. The latch does not add a trap; it clears
 * one the game already had.
 */
const REACH = (ROCK.half[0] + ROCK.half[2]) / Math.SQRT2;

async function outOfCorner(strafeDir) {
  const { Enemy } = await import('../../src/game/Enemy.js');
  const w = await stubWorld();
  const half = new THREE.Vector3(...ROCK.half);
  const yaw = (r) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
  const vertex = REACH * 2;                        // how far up +Z the V sits
  const boxes = [
    w.physics.addStaticBox(new THREE.Vector3(-REACH, ROCK.centreY, vertex), half, yaw(Math.PI / 4)),
    w.physics.addStaticBox(new THREE.Vector3(REACH, ROCK.centreY, vertex), half, yaw(-Math.PI / 4)),
  ];
  const e = loneBody(Enemy, w, [0, 0], strafeDir);
  const ctx = { enemies: w.enemies, particles, terrain: w.terrain, physics: w.physics,
    bolts: w.bolts, time: 0, camera: w.engine.camera };
  /* Ordered THROUGH the vertex, far enough beyond it that the wish never turns
   * into "you have arrived" while the body is still in the corner. */
  const goal = new THREE.Vector3(0, 0, vertex * 4);
  const out = REACH * 3;
  /* Twenty seconds — four times the 4.8 s the fixed build takes, and the broken
   * one spends all of it in the vertex. */
  const frames = Math.round(20 / DT);
  const chest = new THREE.Vector3();
  let used = frames, escaped = false, touched = false, deepest = -Infinity;
  for (let i = 0; i < frames; i++) {
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(goal.x - e.position.x, 0, goal.z - e.position.z).normalize();
    e._move(DT, ctx);
    if (e._wallT > 0) touched = true;
    chest.set(e.position.x, e.position.y + CHEST, e.position.z);
    for (const b of boxes) deepest = Math.max(deepest, depthIn(b, half, chest));
    if (Math.abs(e.position.x) > out || e.position.z > vertex + REACH * 2) { used = i + 1; escaped = true; break; }
  }
  const r = { strafeDir, escaped, touched, deepest, seconds: used * DT,
    at: `${e.position.x.toFixed(1)}, ${e.position.z.toFixed(1)}` };
  e.dispose?.();
  return r;
}
