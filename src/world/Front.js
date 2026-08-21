/**
 * BATTLEFRONT BORZ — THE MARCHING FRONT, as the five things you can see of it.
 *
 * This is `FLAGSHIP.md` §14 Step 1's debug path and nothing more. It is NOT
 * wired to a mode, no level calls it, and it is reached only from
 * `tools/_flagship.mjs` and `tools/_frontshot.mjs`. It exists so that the kill
 * test can be run at all — three screenshots from the same spot at engagements
 * 1, 3 and 5, shuffled, and the player either puts them in order or the front
 * is not a visible variable and §14's ~600-line fallback is the mode.
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
import { addSmokeColumns, smokeSites } from './Smoke.js';
import { addFallen } from './Fallen.js';

/** Where the line stands before the first engagement, in metres from the spot
 *  the player is standing on. */
export const FRONT_START = 180;
/** How much ground it takes each engagement. §14: `rmin: 220 − 40·n`. */
export const FRONT_STEP = 40;

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

/** Has the line already crossed this point? */
export function burnt(front, x, z) {
  return x * front.dir.x + z * front.dir.z > front.distance;
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
 * @returns {number} craters laid
 */
export function walkingBarrage(terrain, from, bearing, opts = {}) {
  if (!terrain?.crater) return 0;
  const n = opts.count ?? 8;
  const step = opts.step ?? 14;
  const rng = makeRng(opts.seed ?? 991);
  const cx = Math.cos(bearing), cz = Math.sin(bearing);
  let laid = 0;
  for (let i = 0; i < n; i++) {
    const along = i * step;
    const side = (rng() - 0.5) * 4.4;
    const x = from.x + cx * along - cz * side;
    const z = from.z + cz * along + cx * side;
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
 * @returns {number} marks laid
 */
export function burnBand(terrain, front, opts = {}) {
  if (!terrain?.scorch) return 0;
  const rng = makeRng(opts.seed ?? 7717);
  const dx = front.dir.x, dz = front.dir.z;
  /* ACROSS the advance, not along it. The line is the set of points at
   * `distance` along the bearing, so it runs along the perpendicular — and it
   * has to run out past the frame, or the swath ends in mid-air at the edge of
   * shot and reads as a rug. 260 m each way covers a 60° frame at the far end
   * of the schedule with room over. */
  const ax = -dz, az = dx;
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
    const along = front.distance + r * rowStep + (rng() - 0.5) * rowStep;
    for (let k = -half; k <= half; k += step) {
      if (rng() > density) continue;
      const across = k + (rng() - 0.5) * step * 1.6;
      const x = dx * along + ax * across;
      const z = dz * along + az * across;
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
  const front = frontAt(n, opts);
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
  const start = {
    x: front.dir.x * (front.distance + 6 + rng() * 20) - Math.cos(across) * 52,
    z: front.dir.z * (front.distance + 6 + rng() * 20) - Math.sin(across) * 52,
  };
  out.barrage = walkingBarrage(T, start, across, { seed: seed + n * 31 });

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
    addSmokeColumns(world, sites, opts.air || {
      wind: [0.94, 0.34], color: 0x33261f, tip: 0xd0a473, lean: 0.55, spread: 0.22,
    });
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
      /* ON the line, not beyond it. The first pass sited hulls from the line
       * out to 120 m past it, which at engagement 1 is 188–300 m — past the
       * range this level's haze resolves anything at, so the wrecks were
       * invisible in exactly the plate they were supposed to mark. §12.4 says
       * "wrecks belong on the fighting line", and a band straddling the line
       * is what that sentence means. */
      out.wrecks += strew(world, {
        count: 1, angle: a, rmin: Math.max(24, front.distance - 18),
        rmax: front.distance + 60, maxSlope: 0.34, seed: seed + n * 100 + k,
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
