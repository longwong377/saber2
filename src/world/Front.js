/**
 * BATTLEFRONT BORZ — THE MARCHING FRONT, as the five things you can see of it.
 *
 * This was `FLAGSHIP.md` §14 Step 1's debug path and nothing more, and the two
 * sentences that used to stand here — "it is NOT wired to a mode, no level
 * calls it" — are both discharged. `CommandDirector.marchTo` calls
 * `marchFront` once per engagement of THE LINE, so this is the ground the
 * flagship mode is fought on. It is still what the kill test drives: three
 * screenshots from the same spot at engagements 1, 3 and 5, shuffled, and the
 * player either puts them in order or the front is not a visible variable and
 * §14's ~600-line fallback is the mode.
 *
 * ── WHAT THE FRONT *IS*, GEOMETRICALLY ──────────────────────────────────
 *
 * One bearing and one distance. §12.2 asks for a bezier from map edge to map
 * edge with 3–5 control points; a straight half-plane is the degenerate case
 * of that and it is the right thing for a kill test, because a curve would add
 * a second variable to a test whose entire question is *did the one variable
 * read*. If a straight line cannot be ordered from three plates, a bezier
 * cannot either.
 *
 *     burnt(p)  ⟺  (p − origin) · θ̂  >  d(n)
 *
 * …AND IT IS THE DEGENERATE CASE OF A CURVE, WHICH THE GENERATED GROUND
 * ACTUALLY USES. `Battlefield.planBattle` draws a bezier and the ground under
 * a generated run is derived from it, so the four dressing functions below ask
 * `Battlefield.frontLine` — ONE reader, `side(x, z)` and `place(u, depth)` —
 * and the half-plane is what that object collapses to when there is no curve.
 * Nothing below knows which it was handed. Measured: a swath laid across a
 * bezier by the tangent at its chokepoint put 30% of itself on the burnt side
 * at worst; through the reader it is 100% on every seed.
 *
 * θ̂ is the axis of advance, fixed for the whole deployment. `d` starts at
 * 180 m and closes 40 m an engagement to 20 m, which is the same schedule
 * §14 states for the smoke — `rmin: 220 − 40·n` — because the columns stand
 * ON the burnt side and the two numbers must be one number or they will drift
 * apart. Everything past the line is ground that has already been fought over.
 * Everything short of it is clean: standing spires, unbroken ground, no smoke.
 *
 * THE PLAYER DOES NOT MOVE BETWEEN ENGAGEMENTS. That is the whole point and it
 * is what makes the test honest: the camera is at the same place with the same
 * yaw in all three plates, so anything that changes between them is the front
 * and not the framing.
 *
 * ── THE FIVE THINGS IT PUTS ON THE GROUND, AND WHERE EACH CAME FROM ─────
 *
 *   1. CRATERS — replayed from `CraterLog`, which is real and exact (see that
 *      file), plus `walkingBarrage` below, which is new here. §12.4: "a walking
 *      barrage is 8 craters at 14 m on one azimuth, and says *a thing
 *      happened, in a direction, at a time* — which a thousand scattered rocks
 *      cannot."
 *   2. SMOKE — `addSmokeColumns` / `smokeSites` from src/world/Smoke.js, both
 *      already shipping and already used by the Geonosis dressing. The only
 *      thing this adds is the schedule.
 *   3. WRECKS — `strewWrecks` from src/game/Levels.js, which shipped without an
 *      `export` and without a bearing. Both are one line each and both are what
 *      §12.4 asks for: "wrecks belong on the fighting line."
 *   4. THE DRESSING SEED — `beginDressing(world, seed + engagement)`, shipped.
 *   5. THE DEAD — **built, and it is `src/world/Fallen.js`.** This line used to
 *      read "absent, and not faked", and the reason it gave was correct at the
 *      time: §12.4 wants 520 prone instanced figures in a 26 m band and
 *      `Corpses.js` holds real ragdolled bodies with a budget of a few dozen,
 *      which is a completely different object. So the other object was built.
 *      It is the colosseum crowd's argument on the ground — one geometry, one
 *      material, per-instance colour, two draw calls for the whole field —
 *      and it is a thing the game draws rather than a stand-in.
 *   6. THE SWATH — `burnBand` below, into the ground's own long memory. New
 *      here, and it is what `NEXT.md`'s Step 1 verdict asked for: the front's
 *      one visible variable was, in the plates, a fact about the SKY.
 */

import * as THREE from 'three';
import { makeRng, TAU } from '../engine/MathUtil.js';
import { addSmokeColumns, smokeSites, smokeAir } from './Smoke.js';
import { addFallen } from './Fallen.js';
/* THE ONE READER. `Battlefield.js` owns the front's geometry — it is where the
 * bezier is flattened into an arc-length table — so "which side of the front is
 * this, and how far from it" is asked there and nowhere else. A half-plane is
 * the degenerate case and `frontLine` builds it as one, so every function below
 * dresses a curve and a straight line with the same body. See the long note
 * over `frontLine`. */
import { frontLine, frontAtChoke, FRONT_START, FRONT_STEP, FRONT_MIN, FRONT_MARCH } from './Battlefield.js';

/**
 * §14's schedule: the line stands 180 m from the spot the player is standing on
 * before the first engagement and takes 40 m of it each time, down to 20.
 *
 * DECLARED IN `Battlefield.js` AND RE-EXPORTED HERE, which is the wrong way
 * round until you see what depends on it: a generated ground has to be BUILT to
 * carry the march, and a terrain generator cannot import the dressing. The
 * failure that moved them is recorded over the constants there — 352 of 352
 * burn marks under a lava sheet. Every caller still reads them from here.
 */
export { FRONT_START, FRONT_STEP, FRONT_MIN, FRONT_MARCH };

/**
 * THE LINE AT ENGAGEMENT n (1-based).
 *
 * The bearing is drawn off the deployment seed and then never moves — an axis
 * of advance that wandered between engagements would be a different battle
 * each time rather than the same one progressing, which is precisely the
 * failure §13 records against the Spire.
 */
export function frontAt(engagement, opts = {}) {
  const seed = opts.seed ?? 1;
  const bearing = opts.bearing ?? (makeRng(seed ^ 0x1f2e3d4c)() * TAU);
  const n = Math.max(1, engagement | 0);
  const distance = Math.max(opts.min ?? 20, (opts.start ?? FRONT_START) - (n - 1) * (opts.step ?? FRONT_STEP));
  return { bearing, distance, engagement: n,
    dir: { x: Math.cos(bearing), z: Math.sin(bearing) } };
}

/** Has the line already crossed this point? One question, one reader — and on
 *  a half-plane it is the dot product this function has always taken. */
export function burnt(front, x, z) {
  return frontLine(front).side(x, z).d > 0;
}

/**
 * A WALKING BARRAGE — eight craters at 14 m on one azimuth.
 *
 * The one dressing mark in this file that is a SENTENCE rather than a texture.
 * A scatter of craters says "shells landed here"; eight in a line with the
 * spacing even and the ends ragged says "a battery walked its fire across this
 * ground, from over there, toward that". Direction and time, from geometry.
 *
 * Radius and depth are the game's own numbers rather than new ones: 2.6 m ×
 * 0.55 m is `World`'s explosion crater at `size = 1` (World.js line 2484),
 * which is what an artillery round already does to this ground everywhere else
 * in the game. The jitter is ±18% on the radius and ±2.2 m across the track,
 * because eight identical circles perfectly collinear reads as a decal.
 *
 * ── AND IT WALKS ALONG THE FRONT WHEN IT IS GIVEN ONE ────────────────────
 *
 * A battery fires along its own front, so the track of a walking barrage IS
 * the line — which on a bezier is not a bearing. `opts.front` hands this the
 * one reader and the track becomes eight craters at 14 m of ARC, starting
 * `opts.from` metres along it from the centre and `opts.depth` into the burnt
 * side. Without it the signature is the one it has always had, a point and a
 * bearing, and the arithmetic below is unchanged — which is what a straight
 * front is anyway.
 *
 * @returns {number} craters laid
 */
export function walkingBarrage(terrain, from, bearing, opts = {}) {
  if (!terrain?.crater) return 0;
  const n = opts.count ?? 8;
  const step = opts.step ?? 14;
  const rng = makeRng(opts.seed ?? 991);
  const cx = Math.cos(bearing), cz = Math.sin(bearing);
  const line = opts.front ? frontLine(opts.front) : null;
  const u0 = opts.from ?? 0, depth = opts.depth ?? 0;
  let laid = 0;
  for (let i = 0; i < n; i++) {
    const along = i * step;
    const side = (rng() - 0.5) * 4.4;
    /* `side` is the jitter ACROSS the track either way — across the line's own
     * normal on a curve, and across the bearing on a straight one, which is
     * the same vector. */
    const p = line ? line.place(u0 + along, depth + side) : null;
    const x = p ? p.x : from.x + cx * along - cz * side;
    const z = p ? p.z : from.z + cz * along + cx * side;
    if (terrain.inBounds && !terrain.inBounds(x, z)) continue;
    terrain.crater(x, z, (opts.radius ?? 2.6) * (0.82 + rng() * 0.36), opts.depth ?? 0.55);
    laid++;
  }
  return laid;
}

/**
 * THE GROUND THE LINE HAS CROSSED, DRAWN.
 *
 * `NEXT.md`'s Step 1 verdict is that engagement 3 differs from engagement 1
 * only by a pale haze at 100 m. The craters were replaying exactly and were
 * invisible (Step 0), the wrecks were a handful of hulls, and the columns are
 * smoke seen against a sky the same value as the smoke — so the ONE variable
 * §3 calls "a fact about a place you can stand on" was, in the plates, a fact
 * about the sky.
 *
 * This is the ground half, and it is the half that cannot be mistaken for
 * weather: a burnt swath, laid ON the line and thinning out beyond it, into
 * `Terrain.scars` — the field that does not decay and is not a window (see
 * Terrain.js). Called once per engagement and additive, so the ground beyond
 * engagement 1's line carries five bands by engagement 5 and the ground just
 * past engagement 5's line carries one. That gradient is not authored; it is
 * what "this ground has been fought over five times and that ground once"
 * means, and it is the reason the plates can be ordered by looking DOWN.
 *
 * ── WHY A LINE OF DISCS AND NOT A HALF-PLANE FILL ───────────────────────
 *
 * A uniformly darkened half-plane reads as a shadow or a different sand — it
 * has one edge and no internal structure, and the eye files it as terrain.
 * What says *battle* is that the marks are DISCRETE and their density falls
 * off: individual burns at the line, thinning to scattered ones behind, which
 * is the same argument §12.4 makes for the walking barrage. It is also what
 * the scar field is for — its burns stack, so where the discs overlap the
 * ground goes black on its own rather than by being told to.
 *
 * ── AND IT FOLLOWS THE LINE, WHATEVER SHAPE THE LINE IS ──────────────────
 *
 * This function used to build its points as `dir·along + across·k`, which is a
 * half-plane written out. MEASURED on a pass at seed 3 — one of the tighter
 * curves the generator draws — asking for the default ±260 m across a bezier
 * front: **26% of the swath landed on the burnt side.** Three quarters of a
 * burn that is supposed to say "the line came through here" was laid on ground
 * the line has not reached. The stand-in for the curve was the tangent at the
 * chokepoint, and a tangent is good for 80 m on that seed.
 *
 * `frontLine` is the fix and it is one object rather than four: `place(u,
 * depth)` is the point `depth` metres into the burnt side at `u` metres ALONG
 * the line, which on a straight front is exactly the expression this function
 * used to write inline and on a curve is the curve. Nothing else here changed
 * — the same rows, the same thinning, the same draws from `rng` in the same
 * order, so a seeded swath on an authored level is the swath it always was.
 *
 * @returns {number} marks laid
 */
export function burnBand(terrain, front, opts = {}) {
  if (!terrain?.scorch) return 0;
  const rng = makeRng(opts.seed ?? 7717);
  const line = frontLine(front);
  /* ACROSS the advance, not along it — and it has to run out past the frame,
   * or the swath ends in mid-air at the edge of shot and reads as a rug. 260 m
   * each way covers a 60° frame at the far end of the schedule with room over.
   * On a curve the line runs out of map before it runs out of swath, so the
   * reach either way is whatever is left of the arc. */
  const half = opts.half ?? 260;
  const step = opts.step ?? 5.5;
  /* HOW FAR BEHIND THE LINE THE FIGHTING REACHED. `rows` bands at `rowStep`
   * past it, each thinner and paler than the last: a front is not a line, it
   * is a zone about 30 m deep, and the far edge of that zone is where the
   * marks give out. */
  const rows = opts.rows ?? 6;
  const rowStep = opts.rowStep ?? 6.5;
  let laid = 0;
  for (let r = 0; r < rows; r++) {
    /* Thinning with depth into the burnt side. The near row is the line
     * itself and is nearly continuous; the far row is a scatter. */
    const t = r / Math.max(1, rows - 1);
    const density = 1 - t * 0.72;
    /* DEPTH INTO THE BURNT SIDE, measured FROM THE LINE rather than from the
     * deploy point. On a half-plane the two differ by `front.distance`, which
     * is where the line is, so this is the same number it always was. */
    const depth = r * rowStep + (rng() - 0.5) * rowStep;
    for (let k = -half; k <= half; k += step) {
      if (rng() > density) continue;
      const across = k + (rng() - 0.5) * step * 1.6;
      /* PAST THE END OF THE LINE IS NOT ON THE LINE. `place` clamps, so a
       * swath asked for wider than the arc would pile every mark past the end
       * on the last point of it — a blot at the map edge. Dropped instead,
       * which is the same thing `marchFront` does to a smoke column that lands
       * on the clean side and for the same reason. */
      if (across < -line.back || across > line.ahead) continue;
      const p = line.place(across, depth);
      const x = p.x, z = p.z;
      if (terrain.inBounds && !terrain.inBounds(x, z)) continue;
      /* The radius is the level's own crater at `size = 1` and a bit over —
       * 2.6 m is what an artillery round does to this ground everywhere else
       * in the game (World.js), and a scorch is always wider than the hole
       * that made it. The spread is 0.8×-2.0× so a band is not a row of
       * identical stamps. */
      const rad = (opts.radius ?? 3.4) * (0.8 + rng() * 1.2);
      terrain.scorch(x, z, rad, (opts.amount ?? 0.5) * (0.55 + rng() * 0.9) * (1 - t * 0.45));
      laid++;
    }
  }
  return laid;
}

/**
 * THE FRONT THIS ENGAGEMENT IS FOUGHT ON — AND IT IS THE GENERATED ONE WHEN
 * THERE IS ONE.
 *
 * `World._groundKeyFor` publishes `world.battlefield`: the bezier the ground
 * under this run was derived from, its reason, its axis of advance and its
 * one chokepoint. Until now nothing read it. The mode raised a generated
 * heightfield around a curve and then dressed it with a straight line drawn
 * off an unrelated seed, so the burn, the barrage and the dead landed
 * wherever `frontAt` happened to point — which on a generated ground is a
 * front that has nothing to do with the ground it is on. §12.1's whole claim
 * is "generate the battle, then the ground that explains it"; a battle
 * nothing dresses is scenery.
 *
 * THE SCHEDULE IS THE SAME SCHEDULE, MEASURED FROM THE PLAN'S OWN LINE.
 * §14's front closes 40 m an engagement over 160 m of ground, and on a
 * generated ground the place it closes ONTO is the one the plan named: the
 * line starts `FRONT_MARCH` metres beyond the chokepoint and arrives on it
 * at the last engagement. Expressed as an OFFSET of the curve along its own
 * normal, so the front keeps its shape and moves — one battle progressing
 * instead of a different one drawn five times.
 *
 * ABSOLUTE METRES FROM THE DEPLOY POINT IS WHAT IT WAS, AND IT WAS WRONG.
 * `frontAt`'s 180 m is a distance from the PLAYER, which on a generated
 * ground is a line with no relation to the ground under it — and the shelf
 * that stands a sea room's battle out of its own lava is built around the
 * plan's line, so an absolute schedule walked the front straight off it.
 * Measured on the Ember Shelf: **352 of 352 burn marks under the sheet.** `frontLine` reads `offset`; nothing else here knows it exists.
 *
 * `opts.front` overrides both, and an authored level with no plan gets the
 * straight schedule it always got.
 *
 * ── AND IT IS EXPORTED, BECAUSE THE DRESSING IS NOT THE ONLY READER ─────
 *
 * `MODES.theline.lineAdvances` takes an area when a quorum of the living is up
 * with the line, and it measures that against the COMMANDER's own position.
 * This paragraph used to propose the front instead — "your men are on the
 * ground this engagement is about" rather than "your men are near you" — and
 * said a caller should ask this and then `frontLine(front).side(x, z)`.
 *
 * **MEASURED, AND IT WOULD DEADLOCK THE MODE.** `tools/_frontside.mjs` reads
 * the signed distance from each engagement's front to the player and to every
 * man, three seeds, geonosis:
 *
 *     engagement 1   player -182.5 m   men -192 … -183
 *     engagement 2   player -147.1 m   men -156 … -147
 *     engagement 3   player -110.4 m   men -119 … -111
 *
 * The line stands 165–200 m BEHIND the front and is supposed to: the front is
 * the war, it closes `FRONT_STEP` a time across the whole crossing, and a
 * quorum inside `MORALE.NEAR` of it is unreachable at every engagement a
 * sitting actually contains. A rule keyed on it would refuse to take any
 * ground, ever.
 *
 * So the front is not the objective the squad walks onto — it is §3's one-way
 * VISIBLE variable, a fact about the place, and `lineIsUp` keeps the
 * commander-relative quorum. This is left as a correction rather than deleted
 * because the suggestion is a good-sounding one that the next reader would
 * make again.
 */
export function engagementFront(world, engagement, opts = {}) {
  const n = Math.max(1, engagement | 0);
  const plan = opts.plan ?? world?.battlefield ?? null;
  if (!plan) return frontAt(n, opts);
  const offset = Math.max(0, FRONT_MARCH - (n - 1) * (opts.step ?? FRONT_STEP));
  return { ...frontAtChoke(plan, n), distance: plan.distance + offset,
    offset, engagement: n };
}


/**
 * DRESS THE GROUND FOR ENGAGEMENT n.
 *
 * Additive on purpose: a battlefield accumulates, and the plates are meant to
 * be a sequence rather than five independent draws. Calling this for 1, 2, 3…
 * in order is what a session does; calling it once for 4 would give ground
 * that has the fourth engagement's front on it and none of the first three's
 * history, which is the wrong picture.
 *
 * @param world     needs `scene`, `terrain`, `statics`
 * @param opts.engagement  1-based
 * @param opts.seed        the deployment seed; the dressing runs at seed + n
 * @param opts.log         a `CraterLog` to replay before dressing, or null
 * @param opts.wrecks      how many wreck clusters to grow on the burnt side
 */
export function marchFront(world, opts = {}) {
  const n = Math.max(1, opts.engagement | 0);
  const seed = opts.seed ?? 1;
  const front = opts.front || engagementFront(world, n, opts);
  const line = frontLine(front);
  const T = world.terrain;
  const out = { engagement: n, bearing: front.bearing, distance: front.distance,
    replayed: 0, replayMs: 0, barrage: 0, burns: 0, smoke: 0, wrecks: 0, fallen: 0 };

  /* ── 1. THE GROUND'S OWN MEMORY, first, because everything else is placed
   * on top of it and `findSite` reads `terrain.slopeAt`. A wreck sited before
   * the craters arrive can end up standing in a hole. */
  if (opts.log) {
    const r = opts.log.replay(T);
    out.replayed = r.craters; out.replayMs = r.ms;
  }

  /* ── 2. THE BARRAGE, one per engagement, walking ACROSS the axis of advance
   * rather than along it: a battery fires along its own front, not up the
   * enemy's line of approach. Laid just past the line, on the burnt side. */
  const across = front.bearing + Math.PI / 2;
  const rng = makeRng(seed + n * 7919);
  /* WHERE THE BATTERY'S FIRE STARTED: 52 m back along the line from the centre
   * of it, a few metres onto the burnt side. Written as an arc offset and a
   * depth rather than as a point, so it is the same sentence on a curve — the
   * fire walks along the front instead of along a chord of it. */
  const barrageDepth = 6 + rng() * 20;
  const start = line.place(-52, barrageDepth);
  out.barrage = walkingBarrage(T, start, across,
    { seed: seed + n * 31, front, from: -52, depth: barrageDepth });

  /* ── 2b. THE SWATH. The barrage is a SENTENCE — a thing happened, in a
   * direction, at a time — and this is the paragraph around it: the whole
   * width of the line, burnt, thinning out behind. It goes down after the
   * barrage so the two stack in the scar field the way they stacked in the
   * battle, and before the wrecks so `findSite` is reading the ground the
   * hulls will actually stand on. */
  out.burns = burnBand(T, front, { seed: seed + n * 613 });
  T.flush?.();

  /* ── 3. THE COLUMNS, on §14's schedule. `smokeSites` spreads its count over
   * `[rmin, rmax]` on golden-angle bearings, so it fills a RING and not a
   * half-plane; the ones that land on the clean side are dropped rather than
   * the sites being re-rolled, because dropping keeps the golden-angle spacing
   * of the ones that remain and re-rolling would clump them.
   *
   * The wind, the colour and the tip are Geonosis' own — see LEVELS.geonosis'
   * `addSmokeColumns` call. They are passed in rather than read so that this
   * works on any ground; the caller owns its level's air. */
  const rmin = Math.max(20, 220 - 40 * n);
  /* THE COUNT IS ASKED FOR AT THREE TIMES WHAT IS WANTED, and that is not a
   * fudge — it is what the filter costs. `smokeSites` spreads its count over a
   * full RING on golden-angle bearings, and the burnt side is a HALF-PLANE
   * whose boundary is 20–180 m out, so between a quarter and a third of any
   * draw lands on ground the line has crossed. Measured on the first pass at
   * `columns: 9`: three survived, against the seven this level's own dressing
   * puts up — so the kill test's plates were carrying LESS smoke than an
   * undisturbed Geonosis, in the test whose variable is smoke. 24 in gives
   * 7–10 out, which is the level's own density on the half of the map that is
   * burning, and stays under the twenty §11 warns "dominates the sky". */
  const sites = smokeSites(rng, opts.columns ?? 24, { rmin, rmax: rmin + 130, phase: 1.1 + n })
    .filter((s) => burnt(front, s.x, s.z));
  if (sites.length) {
    /* THE LEVEL'S AIR, DERIVED, AND NOT A COPY OF GEONOSIS'. The literal that
     * stood here was Geonosis' `world.smokeAir` written out a second time, and
     * Geonosis is the ONLY level that publishes one — so every other ground
     * THE LINE rolls got a sandy dust tip (`0xd0a473`) and a 20° wind. On
     * alpine that is a `#b6cbee` sky with `#d0a473` smoke in it, leaning 71°
     * off the way that level's own snow blows. `Smoke.smokeAir` derives both
     * from what the level has already said; see its note. */
    addSmokeColumns(world, sites, opts.air || smokeAir(world));
    out.smoke = sites.length;
  }

  /* ── 4. THE WRECKS, on the burnt side ONLY, which is the half of this that
   * `strewWrecks` could not previously express. `findSite`'s `angle` fixes the
   * bearing of the sample and lets the radius fall where it likes, so a wreck
   * asked for at a bearing inside the burnt arc lands on burnt ground by
   * construction — no rejection loop, and no chance of the arc coming up empty
   * on a bad roll the way a reject-and-retry does. */
  /* ── 4a. THE DEAD, ON THE LINE. §12.4: "the dead mark the front — 520 prone
   * instanced figures in a 26 m band, thickest at the choke, one draw call."
   * One band per engagement, so five engagements leave five, and the ground
   * behind the current line carries every one of them. The count is per
   * engagement rather than cumulative for the same reason the crater log is
   * additive: this is a record of what happened, not a picture redrawn. */
  if (opts.fallen !== false) {
    const f = addFallen(world, {
      front,
      origin: { x: front.dir.x * front.distance, z: front.dir.z * front.distance },
      dir: front.dir, count: opts.fallen ?? 110, half: 150, depth: 6.5,
      seed: seed + n * 4211,
    });
    out.fallen = f ? f.count : 0;
    out.fallenCalls = f ? f.calls : 0;
  }

  const strew = opts.strewWrecks;
  if (strew) {
    for (let k = 0; k < (opts.wrecks ?? 3); k++) {
      const a = front.bearing + (rng() - 0.5) * 1.25;
      /* ON THE LINE, WHEREVER THE LINE IS. `findSite` draws a radius band round
       * a centre; the centre used to be the origin, which puts a hull on the
       * front only if the front is a straight line through the deploy point.
       * On a curve the band is measured from a point ON it, drawn along the
       * arc, and the radius band then straddles the line the same way it did.
       * `at` is undefined on a straight front, which is the origin — the
       * behaviour every authored level has. */
      const site = line.curved
        ? line.place((rng() - 0.5) * 260, 0) : null;
      /* ON the line, not beyond it. The first pass sited hulls from the line
       * out to 120 m past it, which at engagement 1 is 188–300 m — past the
       * range this level's haze resolves anything at, so the wrecks were
       * invisible in exactly the plate they were supposed to mark. §12.4 says
       * "wrecks belong on the fighting line", and a band straddling the line
       * is what that sentence means. */
      out.wrecks += strew(world, {
        count: 1, angle: a, at: site,
        rmin: site ? 0 : Math.max(24, front.distance - 18),
        rmax: site ? 40 : front.distance + 60, maxSlope: 0.34, seed: seed + n * 100 + k,
      });
    }
  }
  return out;
}

/**
 * WHERE THE CAMERA STANDS FOR THE KILL TEST, and it is derived rather than
 * chosen so that all three plates cannot drift apart by hand.
 *
 * §4: "at 2.1 m on a plain both armies compress into a 40-pixel band at the
 * horizon — a raindrop cannot see a war." Geonosis has no rise to put the
 * camera on, so the eye is lifted to `height` instead and pitched down; that is
 * the closest this ground can come to §4's "on the lip of one, front at the
 * bottom, 12–18 m of fall", and the gap between the two is itself a finding
 * about whether the flagship's ground generator is needed.
 */
export function frontCamera(front, opts = {}) {
  const back = opts.back ?? 16;
  const height = opts.height ?? 9;
  const pos = new THREE.Vector3(
    -front.dir.x * back, 0, -front.dir.z * back);
  /* THE GAME'S OWN YAW CONVENTION, INVERTED HERE ONCE RATHER THAN GUESSED AT
   * THREE CALL SITES. `Player` builds its forward vector as
   * `-(sin(yaw), 0, cos(yaw))` (Player.js line 3928), so looking along a
   * bearing whose direction is (cos b, sin b) needs
   * `yaw = atan2(-cos b, -sin b)`. Getting this backwards would point the
   * camera at the clean half of the field and the kill test would be three
   * identical plates of empty ground — a "no" that was the instrument's. */
  const yaw = Math.atan2(-front.dir.x, -front.dir.z);
  return { pos, height, yaw, pitch: opts.pitch ?? -0.16 };
}
