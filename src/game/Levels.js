/**
 * SABER — theatres.
 *
 * Each level is a terrain preset, an atmosphere, and a dressing pass that
 * scatters architecture and props. They are large by design — the horde needs
 * somewhere to come from, and a Jedi needs somewhere to fall back to.
 */

import * as THREE from 'three';
import {
  makeCrate, makeBarrel, makePillar, makeVaporator, makeSpire, makeConsole,
  addWall, addRock, BlastDoor, propMaterials, Kit,
  addColumn, addArch, addBrokenWall, addColossus, addOutcrop, addScree,
  addDebrisField, addCrateStack, addRuin, addOutpost, addGantry, addPipeRun,
  addCableRun, addLamp, addScaffold, addRockArch, addBoulderCluster, addHullSection, addTarp,
  addAntenna, addPlinth, addStair, addRailing, addFloorSlab, addSign, addRuinedGate,
  addMachine, addTank, addStanchion, addButtress, addBalcony, addCrowd, addStorm,
} from '../world/Props.js';
import { addHorizon, makeCoverField, ground } from '../world/Scenery.js';
import { registerDestructible } from '../world/Destruction.js';
import { makeRng, clamp, TAU, lerp } from '../engine/MathUtil.js';
import { ARRIVAL_BY_TERRAIN } from './Arrivals.js';
/* The warship's set-piece is registered at the bottom of this file — see the
 * note there. These three edges add nothing to anybody's static import graph
 * that was not already in it: Waves.js already pulls Enemy.js, Enemy.js
 * already pulls Bodies.js, and none of the three reaches Engine.js, which is
 * the edge that matters (see the note at src/world/Scenery.js:566). */
import { ARCHETYPES } from './Enemy.js';
import { SET_PIECE } from './Waves.js';
import { TOUGHNESS } from './Combat.js';
import { buildBodyguard, buildQuadruped } from './Bodies.js';
import { attachRiders, saddleThreat } from './Riders.js';
import { attachForest } from '../world/Trees.js';

let rng = makeRng(20250805);

/* ══════════════════════════════════════════════════════════════════════ */
/*  Composition                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The single biggest reason a procedural level reads as a toy is UNIFORM
 * SCATTER: N objects placed at independent random positions over a disc. Real
 * places are not uniform. Things cluster, because something put them there —
 * a building fell, a convoy stopped, water ran. The eye reads that instantly
 * and reads its absence just as fast.
 *
 * These are the placement primitives the dressing passes compose with. They
 * know nothing about what they are placing, so any new prop maker drops in.
 */

const _p = new THREE.Vector3();

/** Polar sample with a density exponent: <1 crowds the centre, >1 the rim. */
export function polar(rmin, rmax, bias = 1, angle = null) {
  const a = angle ?? rng() * TAU;
  const r = lerp(rmin, rmax, Math.pow(rng(), bias));
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, a, r };
}

/**
 * Is this somewhere a thing could plausibly rest, and is it clear of what is
 * already there? Uniform scatter happily stacks two crates in the same metre
 * and drops a pillar down a cliff face; both read as broken.
 */
export function siteOk(world, x, z, opts = {}) {
  const T = world.terrain;
  if (!T) return true;
  if (T.slopeAt(x, z) > (opts.maxSlope ?? 0.38)) return false;
  const y = T.height(x, z);
  if (opts.minHeight !== undefined && y < opts.minHeight) return false;
  if (opts.maxHeight !== undefined && y > opts.maxHeight) return false;
  // keep the player's own footing clear so a run never starts inside a wall
  const keep = opts.spawnClear ?? 6;
  if (x * x + z * z < keep * keep) return false;
  const taken = world._siteTaken || (world._siteTaken = []);
  const rad = opts.clearance ?? 2.2;
  /* CLEARANCE ZERO MEANS THINGS MAY TOUCH, and that had to become sayable.
   * The mutual-exclusion radius here — 2.2 m by default, 1.4 for a cluster
   * satellite — meant NOTHING IN THE GAME COULD REST AGAINST ANYTHING ELSE,
   * and real ground gets most of its density from exactly that: talus piled
   * against a face, a drift banked behind a rock, a thicket. Forbidding it and
   * then answering the resulting emptiness with more isolated objects is how a
   * landscape ends up evenly dusted with litter instead of composed. A site
   * asked for at zero clearance still RECORDS itself, so anything that does
   * want its own room still gets it. */
  if (rad > 0) {
    for (let i = 0; i < taken.length; i++) {
      const t = taken[i];
      const dx = t.x - x, dz = t.z - z;
      const min = rad + t.r;
      if (dx * dx + dz * dz < min * min) return false;
    }
  }
  taken.push({ x, z, r: rad });
  return true;
}

/** Find a site that passes, or give up rather than force a bad one. */
export function findSite(world, rmin, rmax, opts = {}) {
  for (let i = 0; i < (opts.tries ?? 14); i++) {
    const q = polar(rmin, rmax, opts.bias ?? 1, opts.angle);
    if (siteOk(world, q.x, q.z, opts)) {
      _p.set(q.x, world.terrain ? world.terrain.height(q.x, q.z) : 0, q.z);
      return { pos: _p.clone(), a: q.a, r: q.r };
    }
  }
  return null;
}

/**
 * A cluster: one anchor, then satellites falling off around it. This is the
 * workhorse — a camp, a rockfall, a debris field, a stand of trees. `place` is
 * called with (position, indexInCluster, distanceFromAnchor, clusterAngle).
 */
export function cluster(world, opts, place) {
  const site = findSite(world, opts.rmin ?? 20, opts.rmax ?? 80, opts);
  if (!site) return 0;
  const n = opts.count ?? 6;
  const spread = opts.spread ?? 7;
  let placed = 0;
  for (let i = 0; i < n; i++) {
    // sqrt keeps the areal density even instead of piling everything on the
    // anchor; the bias exponent then lets a caller crowd it deliberately
    const d = Math.pow(rng(), opts.falloff ?? 0.5) * spread;
    const a = rng() * TAU;
    const x = site.pos.x + Math.cos(a) * d;
    const z = site.pos.z + Math.sin(a) * d;
    if (!siteOk(world, x, z, { ...opts, clearance: opts.satClearance ?? 1.4 })) continue;
    _p.set(x, world.terrain ? world.terrain.height(x, z) : 0, z);
    place(_p, i, d, site.a);
    placed++;
  }
  return placed;
}

/**
 * DRIFT — placement through a DENSITY FIELD instead of over a disc.
 *
 * This is the primitive the file was missing, and its absence is what every
 * "jumbled mess of little objects everywhere" reduces to. `polar` draws
 * uniformly: given 500 stones and a 130 m disc it puts one every 33 m², each
 * one alone, everywhere, forever. Measured on the shipped build with the
 * Clark–Evans ratio — mean nearest-neighbour distance over what a Poisson
 * process of the same intensity would give, so 1.0 is indistinguishable from
 * uniform random and below 0.5 is strongly clustered:
 *
 *     dunes R = 0.893    arena R = 0.819    canyon R = 0.800
 *
 * That is uniform scatter with a rounding error of clumping on it, over three
 * thousand objects a level. The field is a `makeCoverField`: a bimodal mask
 * with genuine swathes and genuine clearings, solved to a stated area
 * fraction. Rejection-sampling against it costs a few extra tries per item and
 * turns the same object count into drifts and bare ground.
 *
 * Composition needs the negative space more than it needs the objects. A
 * landscape reads as full when the full parts are full — which is only
 * possible if the empty parts are allowed to be empty.
 *
 * @param {function} opts.field   (x, z) → 0..1 chance of accepting a site
 * @param {number}   opts.count   how many to place
 */
export function drift(world, opts, place) {
  const field = opts.field || (() => 1);
  const rmin = opts.rmin ?? 0, rmax = opts.rmax ?? 120;
  const n = opts.count ?? 60;
  const maxTries = n * (opts.tries ?? 9);
  let placed = 0;
  for (let i = 0; i < maxTries && placed < n; i++) {
    const q = polar(rmin, rmax, opts.bias ?? 1);
    const w = field(q.x, q.z);
    if (rng() > w) continue;
    if (!siteOk(world, q.x, q.z, opts)) continue;
    _p.set(q.x, world.terrain ? world.terrain.height(q.x, q.z) : 0, q.z);
    place(_p, placed, w, q.a);
    placed++;
  }
  return placed;
}

/**
 * A line of things — a colonnade, a wall run, a ridge of wreckage. Straight
 * scatter never produces one, and a single line does more to make a space feel
 * built than fifty scattered objects.
 */
export function run(world, from, to, count, place, opts = {}) {
  const jitter = opts.jitter ?? 0;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = lerp(from.x, to.x, t) + (rng() - 0.5) * jitter;
    const z = lerp(from.z, to.z, t) + (rng() - 0.5) * jitter;
    if (opts.checked !== false && !siteOk(world, x, z, opts)) continue;
    _p.set(x, world.terrain ? world.terrain.height(x, z) : 0, z);
    place(_p, i, t);
    placed++;
  }
  return placed;
}

/**
 * Reset the occupancy grid at the start of a dressing pass — and the stream
 * the whole pass draws from.
 *
 * The reseed is not tidiness. The generator is module scope and was never
 * reset, so a level's layout was a function of HOW MANY TIMES ANYTHING HAD
 * DRESSED ITSELF SINCE THE PAGE LOADED. Measured: the dune sea's fraction of
 * walkable ground with nothing over 1.2 m within 25 m came out at 6.6% dressed
 * on its own and 15.5% dressed after three other levels had run — a 2.4× swing
 * with no code change between the two. That means a player who quits to the
 * menu and redeploys gets a different, and possibly much emptier, level, and it
 * means no measurement of a dressing pass can be trusted or repeated.
 *
 * @param {number} [seed]  the level's own; omit for the shared default.
 */
export function beginDressing(world, seed) {
  world._siteTaken = [];
  world._stoneField = null;
  rng = makeRng(seed ?? 20250805);
  world.terrain?.setMight?.(groundMight(world));
}

/**
 * HOW HARD THIS GROUND IS ABOUT TO BE HIT.
 *
 * "A late-run Force push should visibly crater the ground where an early one
 * barely scuffs it." It did not, and the reason is one line in Player.js:
 * `ctx.terrain.crater(_v1.x, _v1.z, 2.6, 0.22)` — two constants. The same hole
 * on wave one of the foundations as on the crown with a full boon set, at
 * forcePower 0.25 and at 4. The ground was the only thing in the frame that
 * never found out the player had got stronger.
 *
 * The scale is derived HERE, at dressing time, rather than passed at the call
 * site, because dressing is the moment where the run and the heightfield are
 * both in hand and neither Player.js nor World.js has any business knowing
 * about the other. Three inputs, all of them things the player can see they
 * have earned:
 *
 *   the RUNG    0.22 per tier. Four rungs of the Spire is a 66% deeper hole.
 *   the BOONS   0.055 each — the small, steady one, because a boon set grows
 *               faster than the tier does and this is the term that would run
 *               away if it were the big one.
 *   the SLIDER  `forcePower`, entering as its CUBE ROOT. It already multiplies
 *               reach and impulse linearly everywhere else, and cubing that
 *               into the ground as well puts a forcePower-4 push through a
 *               13 m crater. The cube root is the honest law anyway: a blast
 *               that moves k times the material is k^(1/3) wider.
 *
 * `Terrain.setMight` clamps to 0.35–3.2, so nothing here can produce a hole
 * you fall into whatever the settings say.
 */
export function groundMight(world) {
  const run = world?.run && !world.run.done ? world.run : null;
  const tier = run ? (run.tier ?? 0) : 0;
  const boons = run && Array.isArray(run.boons) ? run.boons.length : 0;
  const force = clamp(world?.settings?.forcePower ?? 1, 0.25, 4);
  return (1 + tier * 0.22 + boons * 0.055) * Math.cbrt(force);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Ground                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHERE LOOSE ROCK HAS GATHERED on this level — one field, shared by every
 * pass that spills stone, so the cobble lies around the boulders and the
 * shingle banks where the talus is instead of each grade running its own
 * independent sprinkle over the same ground. Cleared by `beginDressing`.
 *
 * Squared on the way out: the margins of a drift thin out fast instead of
 * trailing a halo of singletons, and a halo of singletons is the thing being
 * fixed.
 */
export function stoneField(world, seed = 3300, opts = {}) {
  if (world._stoneField) return world._stoneField;
  const F = makeCoverField({
    seed: seed * 7 + 13, amount: opts.amount ?? 0.29,
    patch: opts.patch ?? 62, grain: 19, edge: 0.34, extent: opts.extent ?? 130,
  });
  /* STONE SHUNS PLANTS, because they are competing for the same ground: what
   * you get where cover fails is pavement, lag and talus, and what you get
   * where it does not is cover. Two independent fields put their clearings on
   * top of each other by chance, which is how the dune sea ended up with a
   * tenth of its walkable ground carrying neither — and the survey it fails is
   * right to fail it, because that tenth is genuinely nothing at all.
   *
   * Still a bias and not an exclusion — a drift runs into cover at its edge,
   * which is what a real talus toe does — but 0.8 rather than the 0.6 it was
   * first written at, and the number was measured rather than picked. The
   * acceptance test is retried up to seven times, so what decides where a
   * chip lands is the field's SHAPE and not its scale: the accepted
   * distribution is proportional to the weight, and at 0.6 that moved the mean
   * cover under a chip from 0.47 only to 0.41. At 0.8 it is 0.19.
   *
   * Taken off the LIVE field the level is actually growing, matched by
   * terrain, so a stale one from another level's teardown cannot leak in. */
  const cover = ground.grass && ground.grass.terrain === world.terrain ? ground.grass.cover : null;
  const shun = opts.shun ?? 0.8;
  const f = (x, z) => {
    const v = F.at(x, z);
    return v * v * (cover ? 1 - shun * cover.at(x, z) : 1);
  };
  f.raw = F;
  world._stoneField = f;
  return f;
}

/**
 * WHAT LIES ON THE GROUND, and the two measurements that decide it.
 *
 * The first is the one this helper was written for. Sampled on a 4 m grid over
 * the walkable r = 90 m disc, asking how far the nearest object with a
 * silhouette (radius ≥ 0.35 m) is:
 *
 *     dunes  55.1% of the ground had NOTHING within 12 m, median gap 13.4 m
 *     canyon 36.2%,  median 8.7 m
 *     arena  33.1%,  median 6.2 m
 *     hangar  1.0%,  median 0.0 m
 *
 * The second is the one that says the first was answered WRONG. Clark–Evans,
 * the mean nearest-neighbour distance over what a Poisson process of the same
 * intensity would give — 1.0 is indistinguishable from uniform random:
 *
 *     dunes R = 0.893    arena R = 0.819    canyon R = 0.800
 *
 * So the fix for "the ground is empty" had been fifteen hundred to two
 * thousand pebbles of 20 to 95 cm sprayed UNIFORMLY over a 108-165 m disc. It
 * moved the first number and it is precisely what the level was then described
 * as: "a jumbled mess with just little objects everywhere". Filling a
 * landscape with isolated small objects is the opposite of ground cover.
 *
 * Three things changed here.
 *
 * ONE: every grade goes through a DENSITY FIELD now — a `makeCoverField` mask
 * with real swathes and real clearings, solved to a stated area fraction — so
 * the same stones arrive as talus and drifts with bare ground between them
 * rather than as an even dusting. Stones may touch: `siteOk` takes clearance
 * zero, and a talus cone is stones resting on stones.
 *
 * TWO: THE GRIT GRADE IS GONE. It was 520 stones of 22 cm over a 71 m disc,
 * and it was doing a job the terrain shader already does better: `uGritCol`
 * and its slope band paint exactly that grain, in texture, over the whole
 * heightfield, for nothing. At 22 cm a stone is sub-pixel past about ten
 * metres, so what it contributed at range was aliasing, and what it
 * contributed underfoot was the litter the complaint is about. One draw call
 * and 520 objects a level, cut.
 *
 * THREE: the ground cover that replaces it is REAL cover — the grass field's
 * own, which now reaches 400 m instead of 46 and paints the terrain to match
 * out to the edge of the heightfield. That is what "nothing within 12 m" is
 * supposed to mean, and it is what the barrenness survey measures now.
 *
 * The grain LADDER survives all three, because it is the part that was right:
 * landmarks are what you see across the level, boulders are what you fight
 * around, cobble is what you read as ground while standing on it. `addScree`
 * shrinks its chips toward the rim, so each grade's disc is centred somewhere
 * DIFFERENT — four concentric discs is a target, offset ones are a landscape.
 */
function strewGround(world, opts = {}) {
  const T = world.terrain;
  const at = (x, z) => new THREE.Vector3(x, T ? T.height(x, z) : 0, z);
  const seed = opts.seed ?? 3300;
  const R = opts.radius ?? 130;
  const mat = opts.mat || null;
  const bearing = opts.bearing ?? 0.7;
  /* Where loose rock has gathered on THIS level. Coarser than the grass field
   * and thinner: rock collects in fewer, bigger, more definite places than
   * plants do, and every grade shares the one field so the cobble is lying
   * around the boulders instead of in its own independent sprinkle. */
  const field = stoneField(world, seed, { amount: opts.spread ?? 0.29, extent: R });
  const put = (k, rad, count, size, s) => {
    const a = bearing + (k / 3) * TAU;
    addScree(world, at(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3), {
      radius: rad, count, size, inner: opts.inner ?? 0, seed: seed + s, mat, field,
    });
  };
  /* Landmarks — the grade the SILHOUETTE measurement is about, and the one
   * that has to survive the cut, because it is the only thing on the floor big
   * enough to give the ground a scale from across the level.
   *
   * NOT scree. `addScree` orients its chips on all three axes with no limit,
   * which is right for a 20 cm chip and catastrophic at three metres: its
   * geometry is an icosahedron flattened to 0.52, so a large one landing
   * edge-on is a five-metre blade standing vertically in the sand. That is
   * what the first screenshot of this pass showed, and it is why this grade is
   * the boulder maker instead — real broken shapes, tilt capped at ±0.35 rad,
   * each one bedded to its own depth.
   */
  {
    const a = bearing + 1.7;
    addBoulderCluster(world, at(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22), {
      radius: R * 0.94, count: Math.round(64 * (opts.landmarks ?? 1)),
      size: 2.3, seed: seed + 61, mat, field, crowd: 0.52,
    });
  }
  // Boulders — the grade that reads as cover from across the level. Held at
  // 0.95 for the same reason the landmarks are not scree: past about 1.5 m
  // across, a chip stops reading as a stone lying on the ground and starts
  // reading as a shard.
  put(1, R * 0.94, Math.round(280 * (opts.boulders ?? 1)), 0.95, 11);
  // Cobble — the grade you read as ground while standing on it. It takes over
  // the grit grade's budget as well as its own, and spends it where the field
  // says stone has collected rather than everywhere.
  put(2, R * 0.98, Math.round(620 * (opts.cobble ?? 1)), 0.58, 17);
  return 7;
}

/**
 * WRECKAGE AND BONES scattered over the mid distance: the things that are too
 * small to be architecture and too big to be litter, which is exactly the size
 * band an empty level is missing. Placed as clusters, because a hull plate does
 * not land on its own — whatever tore it off scattered the rest of it nearby.
 */
function strewWrecks(world, opts = {}) {
  const n = opts.count ?? 5;
  let placed = 0;
  for (let k = 0; k < n; k++) {
    const site = findSite(world, opts.rmin ?? 55, opts.rmax ?? 150, {
      clearance: 11, maxSlope: opts.maxSlope ?? 0.42, tries: 20,
    });
    if (!site) continue;
    placed++;
    // A ribcage of hull frames, half swallowed: the vertical members are what
    // give it a silhouette at range, and the silhouette is the whole point.
    const yaw = rng() * TAU;
    for (let i = 0; i < 3 + (rng() * 3 | 0); i++) {
      const d = (i - 1.5) * (2.2 + rng() * 1.6);
      const px = site.pos.x + Math.cos(yaw) * d, pz = site.pos.z + Math.sin(yaw) * d;
      const y = world.terrain ? world.terrain.height(px, pz) : 0;
      const h = 1.4 + rng() * 2.6;
      const len = 3.0 + rng() * 2.4;
      /* Buried to a quarter of its height and tilted no more than 0.16 rad
       * about its long axis. Both numbers come off the same arithmetic: a plate
       * `len` long tilted by t lifts one end by len·sin(t)/2, and it only stops
       * floating if that is less than how deep the plate sits. At the first
       * version's 0.34 centre height and ±0.30 rad, a 5.4 m plate raised an end
       * 0.80 m out of ground it was only sunk 0.22-0.64 m into — visible in the
       * first screenshot as slabs hanging over the sand. 0.25·h against
       * 5.4·sin(0.16)/2 = 0.43 m keeps the worst case buried. */
      addWall(world, new THREE.Vector3(px, y + h * 0.25, pz),
        new THREE.Vector3(0.5 + rng() * 0.6, h, len),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (rng() - 0.5) * 0.32, yaw + (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.32)),
        propMaterials().hull);
    }
    addDebrisField(world, site.pos, { radius: 9 + rng() * 5, seed: (opts.seed ?? 2600) + k, count: 30 });
  }
  return placed;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rooms                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A ROOF, and the single most important thing an interior in this engine has.
 *
 * The first render of all four new interiors had the same fault and it was
 * obvious the moment it was looked at: above the walls there was NOTHING. An
 * interior sets `sky: false`, so `scene.background` is a flat `bgColor` and the
 * top third of every frame was an empty black field. A hall with an infinite
 * black ceiling does not read as indoors, it reads as night — which is
 * catastrophic for a descent, because the one thing the player has to believe
 * is that there is rock over their head.
 *
 * IT IS TWO OR THREE BIG SLABS AND THAT IS DELIBERATE. Every survey in the
 * suite treats a piece of geometry over a certain size as scenery rather than
 * as an object — `occupancy` drops meshes wider than 120 m because "the ground
 * plane and the horizon curtains ARE the view", and `assemblies` drops anything
 * over 150 m for the same reason. A roof is exactly that: it is not a thing
 * standing in the room, it is the room. So every panel here is over 150 m on
 * its long axis, which puts it on the right side of both rules honestly rather
 * than by exemption. It also means the roof costs one draw call per panel.
 *
 * `well` opens a slot straight across the hall — the intake's hole in the
 * roof — and it is the only panel arrangement that keeps BOTH panels over the
 * size threshold. A rectangular hole needs four panels and two of them come out
 * 52 m square, which the surveys would then measure as two enormous objects
 * floating fifteen metres up.
 *
 * `shadow` is what makes the well worth having: with it on, a 74° sun through a
 * 30 m slot lays a hard-edged stripe of daylight across the floor, which is
 * rule 2 of the art direction — a cast shadow is a flat SHAPE — at the scale of
 * a whole room. The rooms with no daylight to admit turn it off, because a roof
 * that casts with no opening in it simply deletes their key light.
 */
function roof(world, opts = {}) {
  const M = propMaterials();
  const y = opts.height ?? 15.5;
  const half = opts.half ?? 78;
  const t = opts.thickness ?? 1.6;
  const mat = opts.mat || M.darkSteel;
  const span = half * 2 + 8;                 // > 150 m: scenery, not an object
  const well = opts.well ?? 0;               // half-width of the light slot
  const panels = well > 0
    ? [[0, -(well + (half - well) / 2), span, half - well],
       [0, (well + (half - well) / 2), span, half - well]]
    : [[0, 0, span, span]];
  const made = [];
  for (const [cx, cz, sx, sz] of panels) {
    const m = addWall(world, new THREE.Vector3(cx, y, cz), new THREE.Vector3(sx, t, sz),
      new THREE.Quaternion(), mat);
    m.castShadow = !!opts.shadow;
    made.push(m);
  }
  // The beams under it, so the ceiling has a direction and the ink has
  // something to draw. Kept over the panels rather than over the opening.
  if (opts.beams !== false) {
    const n = opts.beamCount ?? 9;
    for (let i = 0; i < n; i++) {
      const z = (i / (n - 1) - 0.5) * (half * 1.9);
      if (well > 0 && Math.abs(z) < well + 3) continue;
      const b = addWall(world, new THREE.Vector3(0, y - t * 0.5 - 0.55, z),
        new THREE.Vector3(span, 1.1, 1.3), new THREE.Quaternion(), M.darkSteel);
      b.castShadow = false;
    }
  }
  return made.length;
}

/**
 * THE WORKS FLOOR — shared by the intake and the foundry, because they are the
 * same building at two depths and the whole claim of the descent is that you
 * can tell they are.
 *
 * Everything that differs between the two rooms is passed in: the colour of
 * the hazard lamps, whether the melt is running (`hot`), and how much of the
 * place is still being used. Nothing about the LAYOUT differs, and that is
 * deliberate — a facility repeats its bay grid floor after floor, and two
 * rooms that share a plan and share nothing else is exactly the sensation of
 * having gone down one level rather than having been teleported.
 *
 * The bar this pass exists to clear is stated in world-immersion.mjs: a level
 * whose ground has no cover at all — a poured deck scores zero, correctly —
 * has to answer "nowhere you can stand has nothing in reach" on its objects
 * alone, with a MEDIAN gap to the nearest one under 6.5 m across a 138 m room.
 * That is a lot of floor, and it is why almost everything here arrives as an
 * `island`: six draw calls buys six objects instead of one.
 */
function works(world, opts = {}) {
  const T = world.terrain;
  const M = propMaterials();
  const seed = opts.seed ?? 8100;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
  const R = 66;                       // where the shell wall starts climbing
  const lamp = opts.lampColor ?? 0xffb04a;
  const hot = !!opts.hot;

  // The roof first, because everything below is lit under it.
  roof(world, { height: 16.5, half: R + 2, well: opts.well ?? 0, shadow: !!opts.well,
    mat: M.hull, beamCount: 9 });

  /* ── THE SHELL. Bulkhead ribs standing against the terrain wall, so the
   * room has a built edge rather than a hillside painted grey. Every fourth
   * bay is a blast door recess and every seventh has failed — a wall that is
   * uniformly intact reads as a texture. */
  const bays = 16;
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * TAU;
    // walk the RECTANGLE, not a circle: this is a room
    const c = Math.cos(a), s = Math.sin(a);
    const k = 1 / Math.max(Math.abs(c), Math.abs(s));
    const x = c * k * (R - 2), z = s * k * (R - 2);
    const yaw = Math.abs(c) > Math.abs(s) ? 0 : Math.PI / 2;
    const failed = (i * 5 + 2) % 9 < 2;
    // Wall, conduit and door recess merged: separately they were three emits
    // and seven draw calls a bay, and this room measured 469 against a cap of
    // 520 before there was anything on its floor at all.
    island(world, at(x, z), { seed: seed + 10 + i, yaw, span: 17, maker: 'bulkhead' },
      (kit, local) => {
        addBrokenWall(world, local(0, 0), V(16.0, failed ? 4.2 + rng() * 2 : 9.0, 1.7), {
          kit, seed: seed + 20 + i, mat: M.duracrete, ruin: failed ? 0.7 : 0.2,
          openings: i % 4 === 1 ? [{ x: 0, y: 0, w: 4.4, h: 5.2 }] : undefined,
        });
        addPipeRun(world, [
          new THREE.Vector3(-6.5, 7.4, -1.4), new THREE.Vector3(0, 7.7, -1.4),
          new THREE.Vector3(6.5, 7.4, -1.4),
        ], { kit, count: 2, radius: 0.11, seed: seed + 60 + i, supports: false, valves: false });
      });
  }

  /* ── THE PLANT, on the surveyed bay grid. Three kinds of cell, drawn per
   * cell rather than per grid, so the rhythm is a building's and the contents
   * are not. */
  bay(world, {
    nx: 6, nz: 6, pitch: 22.5, jitter: 4.5, skip: 0.08,
    clearance: 8, spawnClear: 11, maxSlope: 0.3,
  }, (pos, i, j, r) => {
    const s = seed + 200 + i * 11 + j;
    if (r < 0.40) {
      // a plant island: two machines, a tank and the stanchion carrying the
      // pipework over them
      island(world, pos.clone(), { seed: s, yaw: rng() * TAU, span: 15, maker: 'plant' },
        (kit, local) => {
          addMachine(world, local(-3.2, 0), {
            kit, width: 4.4, height: 3.2, depth: 2.6, seed: s + 1,
            glowMat: hot ? M.glowRed : M.glowAmber,
          });
          addMachine(world, local(3.4, 2.2), { kit, width: 3.0, height: 2.4, depth: 2.0, yaw: 0.6, seed: s + 2 });
          addTank(world, local(3.6, -3.6), { kit, radius: 1.7, height: 5.4, seed: s + 3 });
          addPipeRun(world, [
            new THREE.Vector3(-3.2, 3.6, 1.4), new THREE.Vector3(0.4, 4.4, 1.4),
            new THREE.Vector3(3.6, 5.6, -1.6),
          ], { kit, count: 2, radius: 0.12, seed: s + 4 });
        });
    } else if (r < 0.72) {
      // a structural frame: two stanchions and the truss between them, which
      // is what is actually holding the roof up over this bay
      island(world, pos.clone(), { seed: s, yaw: rng() * TAU, span: 11, maker: 'frame' },
        (kit, local) => {
          for (const sx of [-1, 1]) {
            addStanchion(world, local(sx * 4.2, 0), {
              kit, height: 9.5, lamp: sx > 0, light: sx > 0 && opts.lights !== false,
              color: lamp, intensity: 15, distance: 24, seed: s + 5 + sx,
            });
          }
          kit.slab(M.darkSteel, 9.4, 0.5, 0.7, 0, 10.2, 0, { tile: 2.4, seg: 3, collide: false });
          kit.slab(M.grating, 2.2, 0.12, 3.4, 0, 9.6, 0, { tile: 2.2, seg: 3, collide: false });
        });
    } else {
      // and the stuff of a working floor
      if (r < 0.86) addCrateStack(world, pos.clone(), { seed: s + 6, tiers: 2 + (rng() < 0.5 ? 1 : 0), yaw: rng() * TAU });
      else addMachine(world, pos.clone(), { width: 5.5, height: 4.2, depth: 3.4, yaw: rng() * TAU, seed: s + 7 });
    }
  });

  /* ── Gantries down the two long walls, with the aisle between them kept
   * clear so the fight has a spine. */
  for (const side of [-1, 1]) {
    addGantry(world, at(side * (R - 16), -18), { length: 30, height: 6.4, yaw: Math.PI / 2, seed: seed + 300 + side, lights: opts.lights !== false });
    addGantry(world, at(side * (R - 16), 24), { length: 24, height: 5.4, yaw: Math.PI / 2, seed: seed + 310 + side, lights: opts.lights !== false });
    addCableRun(world, at(side * (R - 3), -30, 8.2), at(side * (R - 3), 26, 7.2), { seed: seed + 320 + side, sag: 1.5 });
  }

  /* ── THE MELT, if this floor is running one. Ladles, slag pots and the tap
   * spouts along the canal — the only warm objects in the room, standing where
   * the light is coming from. */
  if (hot) {
    for (let k = 0; k < 7; k++) {
      const x = -58 + k * 19;
      const zc = Math.sin(x * 0.0121) * 13 + Math.sin(x * 0.0047 + 2.1) * 7;
      const z = zc + (k % 2 ? 15 : -15);
      if (!siteOk(world, x, z, { clearance: 6, spawnClear: 8 })) continue;
      island(world, at(x, z), { seed: seed + 400 + k, yaw: rng() * TAU, span: 10, maker: 'ladle' },
        (kit, local) => {
          addTank(world, local(0, 0), { kit, radius: 2.4, height: 3.0, domeRise: 0.2, seed: seed + 410 + k, trimMat: M.rust });
          kit.slab(M.glowRed, 3.0, 0.16, 3.0, 0, 3.6, 0, { tile: 1.6, seg: 3, collide: false });
          addStanchion(world, local(-3.6, 2.4), { kit, height: 7.0, lamp: true, seed: seed + 420 + k });
        });
      const L = new THREE.PointLight(0xff6a18, 22, 30, 2);
      L.position.set(x, T.height(x, z) + 2.6, z);
      world.scene.add(L); world.levelLights.push(L);
    }
    // and the light the canal itself throws, spaced along it
    for (let k = 0; k < 6; k++) {
      const x = -55 + k * 22;
      const zc = Math.sin(x * 0.0121) * 13 + Math.sin(x * 0.0047 + 2.1) * 7;
      const L = new THREE.PointLight(0xff8a28, 30, 44, 2);
      L.position.set(x, -0.9, zc);
      world.scene.add(L); world.levelLights.push(L);
    }
  }

  /* ── The clutter of people who worked here. Through the drift rather than a
   * uniform sprinkle, because even on a swept floor things end up against
   * things. */
  const field = makeCoverField({ seed: seed * 3 + 7, amount: 0.34, patch: 34, grain: 11, edge: 0.30, extent: R });
  drift(world, {
    field: (x, z) => field.at(x, z), rmin: 12, rmax: R - 6, count: opts.crates ?? 24,
    clearance: 2.6, spawnClear: 11, maxSlope: 0.3, tries: 14,
  }, (pos) => {
    world.addProp(rng() < 0.3 ? makeBarrel(world, pos) : makeCrate(world, pos, 0.85));
  });
  for (let k = 0; k < (opts.stacks ?? 5); k++) {
    const site = findSite(world, 16, R - 10, { clearance: 5, spawnClear: 11, maxSlope: 0.3 });
    if (site) addCrateStack(world, site.pos, { seed: seed + 500 + k, tiers: 3, columns: 3, yaw: rng() * TAU });
  }
  for (let k = 0; k < (opts.wrecks ?? 2); k++) {
    const site = findSite(world, 24, R - 14, { clearance: 12, spawnClear: 14, maxSlope: 0.3, tries: 20 });
    if (site) addHullSection(world, site.pos, { length: 15 + rng() * 8, radius: 3.2, yaw: rng() * TAU, seed: seed + 520 + k });
  }
  for (let k = 0; k < 6; k++) {
    const site = findSite(world, 14, R - 8, { clearance: 6, spawnClear: 11, maxSlope: 0.35 });
    if (site) addDebrisField(world, site.pos, { radius: 8, seed: seed + 540 + k, count: 22 });
  }
  // Swarf, slag and broken plate over the whole floor — the grade a room reads
  // as ground while standing on it, and the one thing here that is instanced.
  strewGround(world, { seed: seed + 600, radius: R - 4, inner: 3, spread: 0.32, mat: M.stone,
    landmarks: 0.35, boulders: 0.8, cobble: 1.5 });

  if (opts.banner) world.notify(opts.banner, opts.note || '');
  return bays;
}

/**
 * THE CUT — the excavation under the works, and the last two rungs of the
 * descent.
 *
 * It is dressed to be READ IN THE DARK, which is a different job from the
 * floors above. Nothing here is small: what a player carrying the only light
 * source in the room can actually see is a silhouette at four metres, so the
 * vocabulary is pit props, spoil heaps, rock and the abandoned end of the
 * machinery — big shapes with a clear outline and nothing that depends on
 * being able to make out detail.
 */
function cut(world, opts = {}) {
  const T = world.terrain;
  const M = propMaterials();
  const seed = opts.seed ?? 8700;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
  const wet = world.level?.water?.level ?? 0.30;

  /* The BACK of the cut. Rock rather than plate, and lower than the works'
   * roof — a heading follows the seam and the seam is not a storey high. */
  roof(world, { height: 13.0, half: 76, mat: M.stone, beams: false, thickness: 2.4 });

  /* ── The face. Rock left standing where the cut stopped, all round the
   * room, with its own talus banked at the foot of it. */
  for (let k = 0; k < 15; k++) {
    const site = findSite(world, 30, 74, { angle: (k / 7) * TAU + rng() * 0.6, clearance: 12, maxSlope: 0.62 });
    if (!site) continue;
    addOutcrop(world, site.pos, { size: 4.5 + rng() * 4, height: 7 + rng() * 8, seed: seed + 100 + k, mat: M.stone });
    addScree(world, at(site.pos.x + (rng() - 0.5) * 8, site.pos.z + (rng() - 0.5) * 8),
      { radius: 11, count: 120, seed: seed + 120 + k, mat: M.stone, field: stoneField(world, seed) });
  }
  for (let k = 0; k < 10; k++) {
    const site = findSite(world, 14, 70, { clearance: 8, maxSlope: 0.7 });
    if (site) addBoulderCluster(world, site.pos, { radius: 8, count: 12, size: 1.6, seed: seed + 200 + k, mat: M.stone });
  }

  /* ── PIT PROPS on the bay grid. Timbering is the one thing in a cut that IS
   * on a grid — it is holding the roof up, and it was set out by somebody with
   * a rule — so it is the only regular thing in an otherwise broken room, and
   * that contrast is what says "this was a mine and not a cave". */
  bay(world, {
    nx: 5, nz: 5, pitch: 26, jitter: 6, skip: 0.16,
    clearance: 9, spawnClear: 11, maxSlope: 0.34, minHeight: wet + 0.2,
  }, (pos, i, j, r) => {
    const s = seed + 300 + i * 11 + j;
    if (r < 0.55) {
      island(world, pos.clone(), { seed: s, yaw: rng() * TAU, span: 12, maker: 'timbering' },
        (kit, local) => {
          for (const sx of [-1, 1]) {
            addStanchion(world, local(sx * 4.6, 0), {
              kit, height: 6.5 + rng() * 2.5, width: 0.7, mat: M.wood,
              lamp: sx > 0 && r < 0.25, light: sx > 0 && r < 0.25,
              color: 0xffc06a, intensity: 9, distance: 15, seed: s + sx,
            });
          }
          kit.slab(M.wood, 10.2, 0.55, 0.75, 0, 7.4, 0, { tile: 2.4, seg: 3, collide: false });
        });
    } else {
      // the abandoned end of the plant, left standing where it stopped
      island(world, pos.clone(), { seed: s, yaw: rng() * TAU, span: 12, maker: 'derelict' },
        (kit, local) => {
          addMachine(world, local(-2.4, 0), { kit, width: 4.0, height: 2.8, depth: 2.4, seed: s + 3, mat: M.rust, glowMat: M.duracreteDark });
          addCrateStack(world, local(3.4, 1.8), { kit, tiers: 2, columns: 2, seed: s + 4 });
        });
    }
  });

  /* ── The spoil. Where the rock came out and was never taken away: three
   * heaps, each one a landmark you can find your way by in the dark. */
  for (let k = 0; k < 3; k++) {
    const site = findSite(world, 26, 62, { angle: 0.6 + k * 2.1, clearance: 18, maxSlope: 0.3, tries: 22 });
    if (!site) continue;
    addOutcrop(world, site.pos, { size: 8 + rng() * 4, height: 10 + rng() * 5, seed: seed + 400 + k, mat: M.stone });
    /* Through the level's own stone field, like every other loose grade here.
     * `ground-cover.mjs` measures the mean cover UNDER a stone against the
     * level's own mean, and a spoil heap dropped as a plain disc is exactly the
     * uniform sprinkle that test exists to catch — measured, the three heaps
     * and the islands' local rubble alone put the cut's stones on ground 4
     * points MORE covered than the level average. */
    addScree(world, site.pos, { radius: 20, count: 420, size: 0.62, seed: seed + 410 + k,
      mat: M.stone, field: stoneField(world, seed) });
  }

  /* ── The way the ore left: a conveyor gantry running the length of the cut,
   * still standing, still empty. */
  addGantry(world, at(-30, -40), { length: 40, height: 7.2, yaw: 0.3, seed: seed + 500, lights: false });
  addGantry(world, at(28, 34), { length: 32, height: 6.2, yaw: 2.1, seed: seed + 510, lights: false });
  addPipeRun(world, [at(-52, -10, 5.5), at(-18, -6, 6.2), at(16, 4, 6.0), at(48, 12, 5.2)],
    { count: 3, radius: 0.16, seed: seed + 520 });

  /* ── Four worklights, and there are FOUR of them on purpose. This is a room
   * lit by what somebody forgot to switch off; a fifth would start to be
   * lighting rather than evidence. On the last rung the run's own air takes
   * them down to almost nothing anyway — see Run.js. */
  for (let k = 0; k < 4; k++) {
    const a = 0.9 + k * 1.6, r = 26 + (k % 2) * 16;
    const p = at(Math.cos(a) * r, Math.sin(a) * r);
    addLamp(world, p, { height: 5.6, seed: seed + 600 + k, light: true, color: 0xffc478, intensity: 20, distance: 26 });
  }

  /* ── The floor of a flooded cut: silt, and everything that has fallen into
   * it since. */
  strewGround(world, { seed: seed + 700, radius: 74, spread: 0.34, mat: M.stone,
    landmarks: 1.2, boulders: 1.2, cobble: 1.4 });
  for (let k = 0; k < 8; k++) {
    const site = findSite(world, 12, 70, { clearance: 4, maxSlope: 0.32, minHeight: wet + 0.3 });
    if (site) world.addProp(rng() < 0.4 ? makeBarrel(world, site.pos) : makeCrate(world, site.pos, 0.8));
  }
  for (let k = 0; k < 5; k++) {
    const site = findSite(world, 16, 68, { clearance: 7, maxSlope: 0.4 });
    if (site) addDebrisField(world, site.pos, { radius: 8, seed: seed + 800 + k, count: 20 });
  }
  world.notify('THE CUT', 'bring your own light');
  return 12;
}

/**
 * A BAY GRID, and why `drift` is the wrong primitive indoors.
 *
 * Everything above this line is about landscape: things cluster because
 * something put them there, and the field decides where. A BUILDING is the
 * opposite claim. It is on a grid because a surveyor set it out on a grid, and
 * the single loudest tell that an interior was generated is a machine hall
 * whose columns wander. So the interior primitive is a lattice with a stated
 * jitter and a stated dropout, and the composition comes from what is placed
 * in each cell rather than from where the cells are.
 *
 * `place` is called with (position, i, j, cellRandom). A cell is skipped if it
 * fails `siteOk`, so the aisle a level keeps clear stays clear.
 */
export function bay(world, opts, place) {
  const T = world.terrain;
  const nx = opts.nx ?? 5, nz = opts.nz ?? 5;
  const pitch = opts.pitch ?? 22;
  const jitter = opts.jitter ?? 0;
  const skip = opts.skip ?? 0;
  const ox = opts.x ?? 0, oz = opts.z ?? 0;
  let placed = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const r = rng();
      if (r < skip) continue;
      const x = ox + (i - (nx - 1) / 2) * pitch + (rng() - 0.5) * jitter;
      const z = oz + (j - (nz - 1) / 2) * pitch + (rng() - 0.5) * jitter;
      if (opts.checked !== false && !siteOk(world, x, z, opts)) continue;
      _p.set(x, T ? T.height(x, z) : 0, z);
      place(_p, i, j, r);
      placed++;
    }
  }
  return placed;
}

/**
 * AN ISLAND — several makers merged into one object, and the reason every
 * interior in this file is built out of them.
 *
 * A `Kit` emits one mesh per MATERIAL, so a machine that uses six of them is
 * six draw calls however small it is, and `world-immersion` caps a level at
 * 520. Composing a plant island — three machines, a tank, a stanchion and the
 * pipework tying them together — into one kit costs the same six and buys six
 * objects. That is the whole difference between an interior that can afford to
 * be dense and one that cannot.
 *
 * The size cap is not decoration. `occupancy` records one merged mesh as one
 * box at its own half-width, and `assemblies` throws away anything over 150 m,
 * so a room-wide kit would either claim a seventy-metre radius of "something
 * in reach" it does not have, or vanish from the survey entirely. Islands are
 * held to `span` — 16 m by default, about the size of a real plant group — so
 * what the survey records is what is actually there.
 *
 * `build` is called with (kit, local) where `local(x, z)` returns a kit-space
 * position with the TERRAIN's height at that point, so an island composed flat
 * still follows the floor it is standing on.
 */
export function island(world, pos, opts, build) {
  const kit = new Kit(opts.seed ?? 1);
  const span = opts.span ?? 16;
  const yaw = opts.yaw ?? 0;
  const T = world.terrain;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const local = (x, z) => {
    // kit space is rotated by `yaw` about the island origin, so the world
    // point this cell lands on has to be un-rotated to sample the ground
    const wx = pos.x + x * cos + z * sin, wz = pos.z - x * sin + z * cos;
    return new THREE.Vector3(x, (T ? T.height(wx, wz) : 0) - pos.y, z);
  };
  kit.push(0, 0, 0, yaw);
  build(kit, local, kit.rng);
  kit.pop();
  const res = kit.emit(world, pos, new THREE.Quaternion(), opts);
  if (res && res.meshes) for (const m of res.meshes) m.userData.__maker = opts.maker || 'island';

  /**
   * AND THE BLADE CAN REACH IT, which it could not before and which is notes 9
   * and 57: "some objects ignore the saber entirely but can be stood on",
   * "everything touchable must have real physics and be sliceable".
   *
   * A maker called on its own goes through `kitClose`, which registers the
   * piece with the Destruction manager and is why a column placed by a level
   * can be cut down. An island BYPASSES that: it merges several makers into
   * one Kit and emits it here, and `kitClose` explicitly lifts a composed
   * maker's parts back out rather than registering them, because half a merged
   * mesh cannot be hidden when it breaks. So everything built as an island was
   * a static box with a picture on it — measured by `sliceable.mjs`, the Jedi
   * Temple had FIFTY-ONE reachable human-scale objects in it and not one of
   * them could be touched, because the whole hall is islands.
   *
   * Registering the merged mesh fixes it for one draw call and a bounds
   * computation: the manager pre-fractures only what is ever threatened, so an
   * island nobody swings at costs exactly what it cost before.
   *
   * `stone` is the default because most islands in this file are masonry, and
   * the two that are not — a plant bank and a ship's frame — say so. A caller
   * may pass `destructible: false` for something that genuinely should be
   * scenery, which is the same escape hatch the crowd uses.
   */
  if (res && res.meshes && res.meshes.length && opts.destructible !== false) {
    registerDestructible(world, {
      kind: opts.maker || 'island', profile: opts.destructible || 'stone',
      seed: opts.seed ?? 1, meshes: res.meshes, boxes: res.boxes,
      position: pos, quaternion: new THREE.Quaternion(),
    });
  }
  // …and the island takes its own room on the site map, so the next one does
  // not land inside it.
  siteOk(world, pos.x, pos.z, { clearance: span * 0.5, spawnClear: 0 });
  return res;
}

export const LEVELS = {
  /* ══════════════════════════════════════════════════════════════════════
   *  THE THREE THE PLAYER ASKED FOR
   *
   *  "a map of just rolling green meadow hills of grass blowing endlessly
   *   into the misty horizon (zelda esque)... another map of just endless
   *   sand dunes that you deform with sand storms, and another in a
   *   blizzard/mountain."
   *
   *  Two things about "endless" are worth writing down once, here, because
   *  all three of these levels live or die on them.
   *
   *  The world is a hard-bounded box — 520-560 m of heightfield with a
   *  position clamp at Player.js — and there is no streaming, tiling or wrap.
   *  So endlessness is an ILLUSION, and the two things that sell it are the
   *  painted ranges (addHorizon) and the air between you and them. Neither is
   *  decoration; they are the level's edge, and the dune sea's own comment
   *  says so: "without these you can see where the world stops".
   *
   *  And the counter-intuitive half, measured rather than assumed: a LOW mist
   *  does not hide the far ranges, it reveals them. The ranges stand 30-80 m
   *  tall, so a ray to a distant crest climbs out of a shallow fog almost
   *  immediately — at fogHeight 9 the three ranges are 5% fogged against 37-61%
   *  at the default 38. That is peaks floating above a sea of mist, which is
   *  gorgeous and is the opposite of hidden. The meadow wants it. A level that
   *  wants the ranges BURIED needs tall fog instead.
   * ═════════════════════════════════════════════════════════════════════ */

  meadow: {
    name: 'The Green Reach',
    blurb: 'Hills of long grass to a misty horizon. Nothing here was built; nothing here is cover.',
    terrain: 'meadow',
    pool: ['b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte'],
    groundColor: 0x8a7a52,
    spawnRadius: [34, 58],
    atmosphere: {
      // Clean air and a high sun: the meadow is the one level whose subject is
      // the ground itself, so the sky's job is to light it and get out of the
      // way. Rayleigh up and mie down against the dune sea — haze is the
      // desert's material, not this one's.
      turbidity: 5.2, rayleigh: 2.0, mie: 0.007, mieG: 0.79,
      // The swell runs along (0.42, 0.91), i.e. 25 deg. A sun ALONG that
      // bearing lights crest and trough alike and the hills disappear; 115 deg
      // rakes across them, so every rise has a lit face and a shaded one. That
      // is the whole silhouette of this level.
      // 31, not 34: the arena is at 34 and the indirect budget is ordered by
      // elevation across every outdoor level, strictly. Two levels at the same
      // sun height cannot both be on the correct side of each other.
      elevation: 28, azimuth: 115,
      sunColor: 0xfff6e2, sunIntensity: 6.4, ambient: 0.42,
      skyColor: 0xa8c8f0, groundColor: 0x6f7480,
      fillColor: 0x86a0c8, fillIntensity: 0.30,
      // A REAL MIST LAYER, not a wash. fogHeight is the e-folding scale height
      // and fogBase the altitude at which fogDensity is exact, so this is
      // 1.65x density at the player's boots, 0.74x at 8 m and 0.08x at 30 m:
      // something with a top, that you stand in and can see over. It dissolves
      // the ground at 43% by 60 m and 100% by 200 m — the world's edge is gone
      // — while leaving the ranges' crests only 20% veiled.
      // A COMPROMISE, and worth stating because the pretty answer is wrong.
      // fogHeight 10 gives a gorgeous shallow mist with the far ranges standing
      // clear above it — and that is the problem: a range that is only 5%
      // fogged has had no aerial perspective applied to it at all, so it keeps
      // its own chroma and comes out MORE saturated than the sky behind it,
      // which is the one thing distance never does. 26 still reads as a layer
      // with a top (1.3x density at the boots, 0.36x at 25 m) while fogging the
      // ranges enough that they converge on the band they stand in.
      fogColor: 0xd9e3f0, fogDensity: 0.0088, fogHeight: 34, fogBase: 2,
      cloudCover: 0.42, cloudLit: 0xfdf8ee, cloudDark: 0x8a97a8,
      cloudWindDir: 3.58, cloudWindSpeed: 1.5,   // radians, like every other level
      // Desaturated toward the sky, not toward the grass: aerial perspective
      // TAKES chroma away. A green range reads as a hill 200 m off; it does not
      // read as distance.
      // NO DISTANT LANDFORMS ON THIS LEVEL, and it is a decision rather than an
      // omission. The player asked for grass "blowing endlessly into the misty
      // horizon" — mist, not mountains — and at this density the ground is 43%
      // dissolved by 60 m and 100% by 200 m, so the world's edge is hidden by
      // AIR rather than by a painted ridge. Every other outdoor level hides its
      // edge with three ranges because its air is clear enough to see the edge
      // through; this one does not have that problem.
      //
      // The honest part: I also could not satisfy the range-chroma test here.
      // A range must come out less saturated than the sky it stands in, and
      // meadow's came out 0.019 above it — invariant to every colour, fog,
      // shade and geometry knob I moved, which points at the asymptote being
      // baked at one elevation while the sky is not flat across the band. That
      // is a real finding about `addHorizon` and it is written down at the
      // bottom of this file rather than papered over; a level with no ranges
      // does not exercise it either way.
      horizon: false,
      exposure: 0.90, saturation: 1.06,
    },
    ambience: { wind: 0.26, windFreq: 340, drone: 0.0 },
    dust: {
      // Pollen and seed rather than grit, and no heat shimmer: shimmer is gated
      // on sunIntensity > 5, which a bright meadow trips, and a desert mirage
      // over wet grass is the wrong instinct fired by the right number.
      count: 700, color: 0xd6d9a8, opacity: 0.16, size: 15, shimmer: false,
      fleckColor: 0xc2cf94,
      wind: { from: 205, strength: 2.6, gustiness: 0.66, wander: 0.45 },
      // A wind squall, not a dust storm: the drama here is the grass going over
      // in a wave and the light flattening, not the air filling with solids.
      weather: { peak: 0.68, period: 104, duration: 40, fogGain: 3.0, windGain: 2.6,
                 sunLoss: 0.62, fillGain: 1.0, unrest: 0.20, tint: 0.72 },
    },
    /* EVERYTHING is grass, and 1.4 is not a fraction — it is a DENSITY, and
     * the two things it feeds pull in opposite directions on purpose.
     *
     * The cover FIELD saturates: `clamp(0.24 + 0.72·density, 0.12, 0.95)` is
     * already at its ceiling at density 1, and the ceiling is right — a check
     * forbids going past 0.98 because "a field with no clearings in it is a
     * carpet", and a meadow does have bare crowns and worn tracks through it.
     * So this number cannot and does not make the field cover more ground.
     *
     * What it moves is the BUDGET, `count · 2.2 · (0.5 + 0.5·min(density, 1.4))`
     * — 1.2× the instances, spent on the same 95% of ground — and the ground
     * TINT under them, 0.94 against 0.76. Both are the difference between a
     * field that covers 95% of the map at 34% closure and one that closes it.
     * 1.4 is exactly where the budget term saturates; past it nothing happens.
     */
    grass: 1.4,
    grassTint: [0x7f9440, 0x4e6128],
    dress(world) {
      const M = propMaterials();
      beginDressing(world, 20250805 + 41);
      // Tors. The only vertical thing in the level, so they are what you
      // navigate by and what you fight around — sparse, big, and far apart.
      for (let k = 0; k < 13; k++) {
        const site = findSite(world, 22, 104, { angle: (k / 5) * TAU + rng() * 0.7, clearance: 18, maxSlope: 0.26 });
        if (!site) continue;
        addOutcrop(world, site.pos, { size: 4 + rng() * 5, height: 5 + rng() * 6, seed: 900 + k, mat: M.stone });
      }
      // and the loose stone the tors shed, thin: this is pasture, not scree.
      strewGround(world, { seed: 7720, radius: 130, spread: 0.24, mat: M.stone,
        landmarks: 1.3, boulders: 0.8, cobble: 0.7 });
      return 9;
    },
  },

  drifts: {
    name: 'The Shifting Waste',
    blurb: 'Dunes twice the height of the sea, and a storm that comes for you every ninety seconds.',
    terrain: 'drifts',
    pool: ['b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'],
    groundColor: 0xd2bd92,
    spawnRadius: [36, 60],
    atmosphere: {
      turbidity: 8.5, rayleigh: 2.3, mie: 0.013, mieG: 0.84,
      // Same rule the dune sea derives: the sun sits anti-parallel to the dune
      // train so windward faces are lit and slip faces are in shadow. This
      // train runs along (0.79, 0.61) — 52 deg — so the sun goes at 232.
      elevation: 23, azimuth: 232,
      sunColor: 0xffe6b4, sunIntensity: 7.6, ambient: 0.31,
      skyColor: 0xb8cef0, groundColor: 0x8a7248,
      // Skylight is BLUE. Authoring the fill off the ground was the instinct
      // and it is wrong twice over: the fill stands for the dome, and a warm
      // fill leaves a dune sea with no cool anywhere to play the sand against.
      fillColor: 0x92a2cc, fillIntensity: 0.40,
      // 0.0050, not higher: the storm multiplies this by fogGain and the fog
      // cap binds at 0.030, so an already-thick calm air reaches the cap before
      // the storm has done anything and the front stops being an event.
      // Dimmer and less saturated than the drawn skyline, because a surface seen
      // THROUGH a medium cannot come out brighter than the medium. Authoring
      // this as a sand swatch put the haze above its own sky.
      fogColor: 0xcdc6b8, fogDensity: 0.0044,
      // Warm tops, COOL undersides: a cloud base is lit by the sky bouncing off
      // the ground, so painting it the colour of the sand is painting the wrong
      // light source.
      cloudCover: 0.38, cloudLit: 0xffeed0, cloudDark: 0xa4adba,
      cloudWindDir: 4.05, cloudWindSpeed: 1.1,
      horizonAmount: 1.0, horizonScale: 0.8, horizonColor: 0xa8875e,
      exposure: 0.86, saturation: 1.02,
    },
    ambience: { wind: 0.22, windFreq: 610, drone: 0.04 },
    dust: {
      count: 1700, color: 0xd2bd92, opacity: 0.40, size: 30,
      fleckColor: 0xbba876,
      wind: { from: 232, strength: 3.4, gustiness: 0.62, wander: 0.28 },
      // THE HARD ONE. The dune sea leaves most of its storm on the table —
      // sunLoss and fillGain there are the defaults, never authored. Here the
      // key-to-fill goes 24:1 to under 1:1 at peak, which is genuinely flat,
      // shadowless light, and the wind reaches 13.6 m/s. `span` 200 makes the
      // wall take 18 seconds to cross instead of 7: a slower, more massive
      // front. `unrest` 0.22 is a hard ceiling — SkyDome gates its own front on
      // smoothstep(0.22, 1.0), so above it the sky reads a permanent storm.
      weather: { peak: 1.0, period: 92, duration: 48, unrest: 0.22, span: 200,
                 fogGain: 6.14, windGain: 3.0, sunLoss: 0.90, fillGain: 1.6, tint: 1.0 },
    },
    /* NO GRASS. "The dune sea must have no grass either — Sahara/Tatooine
     * sand." A deep erg is moving sand with a storm over it every ninety
     * seconds; nothing is rooted in it, and 0.54 of a cover field put tussock
     * on the slip faces of dunes that avalanche.
     *
     * What stands in for it is not nothing. This is the level with the
     * shortest surface memory in the game — see `loose` on the drifts preset —
     * so the ground here is a record of the last minute of the fight, being
     * combed out from under you.
     */
    grass: 0,
    dress(world) {
      const M = propMaterials();
      beginDressing(world, 20250805 + 43);
      addHorizon(world, {
        seed: 8815,
        layers: [
          { radius: 172, low: 14, high: 36, shade: 0.62 },
          { radius: 252, low: 24, high: 58, shade: 0.70 },
          { radius: 344, low: 40, high: 92, shade: 0.78 },
        ],
      });
      // Half-buried wreckage: the only things that break a dune field's line,
      // and the only way to tell one trough from another.
      // Landmarks, explicitly. A dune field with only scatter on it has nothing
      // on the skyline to steer by, which is where "featureless" comes from —
      // and the barrenness survey measures exactly that.
      for (let k = 0; k < 5; k++) {
        const site = findSite(world, 30, 84, { angle: (k / 5) * TAU + rng() * 0.5, clearance: 15, maxSlope: 0.34 });
        if (!site) continue;
        addOutcrop(world, site.pos, { size: 5 + rng() * 4, height: 7 + rng() * 6, seed: 640 + k, mat: M.stone });
      }
      strewWrecks(world, { seed: 8820, radius: 118, clusters: 7, mat: M.hull });
      strewGround(world, { seed: 8826, radius: 124, spread: 0.30, mat: M.stone,
        landmarks: 1.1, boulders: 1.0, cobble: 1.0 });
      return 9;
    },
  },

  alpine: {
    name: 'The White Pass',
    blurb: 'A cirque above the treeline, in weather that arrives sideways.',
    terrain: 'alpine',
    pool: ['b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte'],
    groundColor: 0xe2dcce,
    spawnRadius: [30, 52],
    atmosphere: {
      turbidity: 3.0, rayleigh: 3.2, mie: 0.005, mieG: 0.76,
      // The ribs run along (0.62, -0.78) — 141 deg — so the sun goes at 322,
      // raking across the benches rather than down them.
      elevation: 17, azimuth: 322,
      // A cold key and a very strong sky: above the treeline in snow, most of
      // what lights you is bounce, and the shadows are blue because they are
      // lit by the dome alone.
      // A 17-degree sun owes its own cast shadow 2.54:1, and snow tempts you to
      // spend the whole budget on bounce — at ambient 0.62 / fill 0.44 the
      // shade came out 2.45:1 and the level had no shadows at all. Snow is
      // bright because its ALBEDO is high, not because the air is.
      sunColor: 0xfff0dc, sunIntensity: 6.8, ambient: 0.30,
      skyColor: 0xbcd6ff, groundColor: 0x9fb2c8,
      fillColor: 0x9ab8e4, fillIntensity: 0.34,
      // fogBase is the altitude at which fogDensity is exact, and it MATTERS
      // here in a way it does not on flat ground: with fogBase 0 the authored
      // air is silently divided by exp(camY/fogHeight), so the same block that
      // gives 116 m of visibility at boot height gives 438 m at y=35. Set to
      // the cirque floor so the number reads back the same wherever you fight.
      fogColor: 0xb6cbee, fogDensity: 0.0072, fogHeight: 40, fogBase: 18,
      cloudCover: 0.66, cloudLit: 0xf2f6fd, cloudDark: 0x7e8ea6,
      cloudWindDir: 5.62, cloudWindSpeed: 2.6,   // radians
      horizonAmount: 1.3, horizonScale: 1.5, horizonColor: 0x8fa2bb,
      exposure: 0.88, saturation: 0.94,
    },
    ambience: { wind: 0.34, windFreq: 780, drone: 0.03 },
    dust: {
      count: 700, color: 0xdfe9ff, opacity: 0.26, size: 20,
      fleckColor: 0xd4e2f7, shimmer: false,
      wind: { from: 322, strength: 4.2, gustiness: 0.55, wander: 0.30 },
      // Snow that falls even in calm air, and a hundred times more of it at the
      // front. `tint` 0.92 is what makes this a BLIZZARD rather than a dust
      // storm wearing white: it decides how far the surviving beam takes the
      // colour of what it came through, and at 0.6 — the value that used to be
      // hardcoded — a snowstorm's sun lands on neutral instead of cold.
      snow: { count: 9000, calm: 0.18, color: 0xeef3fb },
      weather: { peak: 1.0, period: 132, duration: 48, unrest: 0.18,
                 fogGain: 4.2, windGain: 2.9, sunLoss: 0.85, fillGain: 1.3, tint: 0.92 },
    },
    // Dead tussock through the snow, not a lawn: it is what tells you the wind
    // direction at a glance, and what makes the white read as ground rather
    // than as paper.
    /* NO GRASS. "The tundra/ice maps must have NO GRASS AT ALL." A cirque
     * above the treeline is above the treeline; 0.44 of a cover field put
     * tussock through the snowpack of a level whose base coat is snow, on
     * ground the same preset declares is under 10 cm to 95 cm of it.
     *
     * The snow is the cover. It is ankle to waist deep (Terrain's `mantle`),
     * it takes a print from the player and from every enemy, and it fills
     * those in over minutes rather than seconds — the longest memory in the
     * game, because that is what a snowfield is.
     */
    grass: 0,
    dress(world) {
      const M = propMaterials();
      beginDressing(world, 20250805 + 47);
      // Tall and close: this is the one level where the far ranges are the
      // subject rather than the edge, so they get the canyon's proportions and
      // then some.
      addHorizon(world, {
        seed: 9926,
        layers: [
          { radius: 186, low: 30, high: 62, shade: 0.50 },
          { radius: 266, low: 48, high: 96, shade: 0.58 },
          { radius: 356, low: 70, high: 146, shade: 0.68 },
        ],
      });
      for (let k = 0; k < 14; k++) {
        const site = findSite(world, 20, 100, { angle: (k / 6) * TAU + rng() * 0.6, clearance: 14, maxSlope: 0.40 });
        if (!site) continue;
        addOutcrop(world, site.pos, { size: 4 + rng() * 5, height: 7 + rng() * 7, seed: 700 + k, mat: M.stone });
      }
      // A cirque floor is talus: this is the one level where the loose rock IS
      // the ground cover, so it runs heavier than anywhere else.
      strewGround(world, { seed: 9932, radius: 130, spread: 0.42, mat: M.stone,
        landmarks: 1.6, boulders: 1.4, cobble: 1.3 });
      return 9;
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE SANCTUM  (key: `arena` — see below)
   *
   *  "Monumental alien ruins of a grand Jedi/Sith temple — colossal broken
   *   architecture, a sense of something that was once sacred and is now a
   *   killing floor."
   *
   *  THE KEY STAYS `arena`. Nine files and four checks name it, `LEVEL_ORDER`
   *  lists it, and a saved profile pointing at it must keep working — so this
   *  is a rework of a level rather than a new one beside it. What changed is
   *  the name, the blurb and the whole of `dress`.
   *
   *  THE ATMOSPHERE DID NOT CHANGE, and that is a decision. The block below is
   *  a measured artefact: it records a hue-separation study (80% of the frame
   *  inside 13° of hue, and the four causes of it), and every number in it is
   *  load-bearing for `lighting.mjs`'s strict ordering of the indirect budget
   *  by sun elevation, for the range-chroma test, and for the cast-shadow
   *  study in `_shade.mjs`. A ruined temple in a desert bowl is lit by exactly
   *  the same sun as an execution ground in a desert bowl. Re-deriving all of
   *  that to change a mood would have been a different, larger change, and a
   *  worse one: what makes this place read as sacred is its ARCHITECTURE.
   *
   *  WHAT MAKES IT MONUMENTAL IS ONE NUMBER, and it is the height of the
   *  order. The old ring was 8.4 m walls with 7.5 m columns in front of them
   *  and a 17 m toppled statue for a landmark — measured on the dressed level,
   *  the tallest object in it stood 18.3 m and NOTHING reached 20. That is a
   *  town wall. A temple is a building whose columns are taller than the
   *  trees, and the whole of "colossal" is that a person standing at the foot
   *  of one is a detail on it: at 30 m and a 2.3 m shaft, the player is 6% of
   *  the height of a column and a third of its diameter.
   *
   *  It costs less than what it replaces, which is the part worth writing
   *  down. Thirty-six broken wall bays plus eighteen colonnade columns is 54
   *  emits; fourteen colossal columns merged two to an island with their own
   *  entablature and rubble is seven. Measured: 411 draw calls before, and
   *  the budget `world-immersion` holds a level to is 520.
   * ═════════════════════════════════════════════════════════════════════ */

  arena: {
    name: 'The Sanctum',
    blurb: 'A temple the size of a mountain, broken open to the sky. It was sacred once, and the floor has other uses now.',
    terrain: 'arena',
    pool: ['b1', 'b1', 'trooper', 'b2', 'droideka', 'acolyte', 'beast', 'walker', 'sniper'],
    groundColor: 0xcfae82,
    spawnRadius: [30, 52],
    /**
     * THE ARENA WAS ONE HUE, and the measurement that says so.
     *
     * Measured on the pinned pose (tools/arena-lane.mjs frame --level arena),
     * over every pixel with enough chroma for a hue to mean anything:
     *
     *     50% of the frame inside  5° of hue
     *     80% of the frame inside 13°
     *
     * — sky 33.9°, mesa ring 29.4°, masonry 34.6°, sunlit sand 35.4°. A desert
     * is not monochrome, and nothing in that list is separated from anything
     * else, so the eye has no structure to read and the image goes flat.
     *
     * Four things were doing it, in order of how much:
     *
     *  1. THE GRADE'S GAIN, [1.04, 1.0, 0.95]. It multiplies red up and blue
     *     down on every pixel in the frame, which pushes warm things further
     *     into warm and drags cool things toward neutral and past it. Measured
     *     through the engine's own sky model: the sunward skyline comes off the
     *     display shoulder at linear (0.995, 0.996, 0.991) — dead NEUTRAL, as a
     *     solar aureole should be — and the band the pinned pose actually shows,
     *     17°–30° of elevation, is barely less so. This gain is what turned that
     *     neutral into 33° orange. A blue sky was being painted tan in post.
     *     Warmth in the highlights is already the split tone's job (uHighTint
     *     is 1.035/1.000/0.955 and applies only above luma 0.12→0.72); doing it
     *     again here, flat across the whole range, is what closed the gap.
     *  2. THE SUN WAS 30° OFF THE VIEW AXIS. At azimuth 210 the default look
     *     across the bowl stared into the solar aureole, which is the one part
     *     of a clear sky that is legitimately white — so the sky the player saw
     *     was a white-to-tan wash and the ground was flat-lit. 248° puts the
     *     sun 68° to the left: the sky ahead is the blue part of the dome, and
     *     everything standing up in the bowl gets a lit side and a shadow side.
     *  3. NOT THE SKY MODEL. Worth writing down because it was the obvious
     *     suspect and it is innocent: turbidity 3.2 / rayleigh 2.9 / mie 0.005
     *     was tried, and measured WORSE — the drawn dome's zenith B/R fell from
     *     3.44 to 2.61, and the physical sky's zenith-to-skyline span fell from
     *     16.8:1 to 9.3:1, which is under the 12:1 the IBL needs to carry any
     *     direction at all (lighting.mjs pins it, and it caught this). Raising
     *     rayleigh brightens the zenith, which is the FLOOR of that ratio, so
     *     "make the sky bluer" and "keep the sky's dynamic range" pull opposite
     *     ways. The authored 6 / 2.4 / 0.010 stands.
     *  4. NOTHING WAS COOL IN SHADE. lift was neutral at [0.008, 0.007, 0.008]
     *     and the fill was left on its default, so shadowed sand differed from
     *     sunlit sand by 0.134 in B/R over the ground band and by 1.7° of hue.
     *     Real shadowed sand is lit by the sky and nothing else. lift now puts
     *     a blue-violet foot under the blacks, and the sky bounce is authored
     *     rather than defaulted: 0x8fb4ff at 0.34 against the default 0x9fc4ff
     *     at 0.25.
     *
     * AFTER, same pose, same regions, same instrument:
     *
     *                                  before        after
     *     50% of the frame inside        5°           10°
     *     80% of the frame inside       13°          171°
     *     sky, anti-sun               201° / 0.35   208° / 0.57
     *     painted skyline             196° / 0.18   211° / 0.36
     *     mesa ring                    29° / 0.17   349° / 0.13 · 17° / 0.30
     *     sunlit sand                  35° / 0.49    36° / 0.48
     *     ground band, lit vs shade   ΔB/R 0.134    ΔB/R 0.147
     *
     * One number went the wrong way and it is a real cost: the ground band's
     * tonal range fell from 3.26:1 to 2.77:1. Part is the blue lift raising the
     * blacks; part is that a cross-lit floor has less of its area at full N·L
     * than one with the sun behind the camera. It is why the fill sits at 0.34
     * and the lift's blue at 0.014 rather than the 0.45 and 0.020 first tried —
     * those measured 2.50:1 for no more hue separation at all.
     */
    atmosphere: {
      turbidity: 6, rayleigh: 2.4, mie: 0.01, mieG: 0.8,
      elevation: 34, azimuth: 248,
      // Warm light against cool shade is the pair, so both ends are authored:
      // the sun a little warmer than it was, and the two sky terms bluer.
      sunColor: 0xffe4b0, sunIntensity: 7.0, ambient: 0.34,
      skyColor: 0xa8c6f6, groundColor: 0x7a6244,
      // The sky bounce onto everything the sun cannot reach. Engine points it
      // opposite the sun for us. The note about 0.45 buying hue with value
      // still holds and INTENSITY IS UNTOUCHED at 0.48 — see the dune sea's
      // block for the measurement that says intensity is what puts a terminator
      // on a shoulder and is the only reason this term earns its place.
      //
      // What comes off is the chroma. 0x7ba4ff is B/R 5.05 in linear against a
      // probe that on THIS atmosphere already delivers B/R 4.34 along this very
      // direction and 2.92 integrated over the whole dome; the fill was a second
      // copy of the probe's directional sky term, laid on bluer than the sky it
      // was standing in for. 0x94a5d4 is the same colour with its chroma scaled
      // to 0.45 about its own luminance: B/R 2.21, luminance identical to four
      // places (0.3798), so the meter, the exposure and the tonal range do not
      // move at all — only the colour of the shade does.
      //
      // Measured on the controlled cast shadow (tools/_shade.mjs), this level's
      // shaded vertical face was saturation 0.320 against its own SUNLIT face at
      // 0.323 — a shaded face as colourful as a lit one, which is what a blue
      // filter looks like and what a shadow does not. Before → after: face
      // 0.320 → 0.105 at hue 213° → 205°, shaded ground 0.394 → 0.310 at
      // 204° → 200°, sunlit ground 0.371 → 0.380 (control), lit-to-shade
      // 3.18:1 → 3.16:1. The shade it is joining is B/R 3.71 and this fill is
      // now 2.22, but that is a measurement and not an enforced ceiling — the
      // canyon has a shade of 2.80 under a fill of 5.05 and is the level that
      // reads correctly, so no threshold survives all three.
      fillColor: 0x94a5d4, fillIntensity: 0.48,
      // 0.0034 put the half-light distance at 245 m, which is further than the
      // rim (170 m) and the near mesas — so the one thing that makes distant
      // rock desaturate and shift toward the sky was barely acting on the only
      // distant rock in the frame. 0.0040 brings it to 208 m.
      //
      // Same note as the dune sea's: this swatch is the NEAR air. It was the
      // second half of a collision — 0xc4b6a4 at hue 33° over sand at hue 30° —
      // and the half that actually showed was where distance CONVERGED, the
      // `skyColor` swatch above. Modelled over 20–240 m — this one in DISPLAY
      // HSV, after the exposure and the grade, unlike the dune sea's note above
      // which is in linear radiance — the ground's saturation used to fall to
      // 0.057 by 160 m and climb back to 0.222 by 240 m at hue 222°; it now
      // falls monotonically to 0.052 and stays inside hue 20–28° all the way.
      //
      // On the frame the same fix is worth much less than that, and it is worth
      // writing down why. The pinned pose sees its own floor only to about
      // 110 m — past that the bowl's own rim is in the way — and the rim wall
      // itself stands 40–68 m UP, where the exponential haze layer has thinned
      // enough to halve the optical depth: 18% of the rim's colour is air, against
      // 37% for floor at the same 175 m. Measured on the rim, before → after:
      // saturation 0.132 → 0.088, luminance 0.429 → 0.436, hue 348.3° → 345.5°.
      // The chroma comes out as it should; the residual magenta is the rim's own
      // SHADED rock under a blue sky probe, not the air in front of it, and no
      // aerial term can or should fix that.
      fogColor: 0xc4b6a4, fogDensity: 0.0040, exposure: 0.9, bloom: 0.38,
      // lift is ADDED after gain, so it lands hardest on the blacks — which is
      // exactly where a sky-lit shadow's colour belongs. 0.014 in blue and not
      // the 0.020 first tried, for the same reason as the fill: past about
      // 0.016 it stops tinting the shadows and starts raising the black point.
      saturation: 1.16, lift: [0.002, 0.005, 0.014], gain: [1.00, 1.0, 1.025],
      // Mesas ringing the bowl, so the arena sits INSIDE a landscape rather
      // than on top of an empty disc. The deck's bases are a COOL grey now:
      // a cumulus base is lit by sky and ground bounce, never by the sun, and
      // an authored warm base was the third large warm surface in the frame.
      cloudCover: 0.44, cloudLit: 0xfff4e2, cloudDark: 0x9aa2b4,
      cloudWindDir: 1.1, cloudWindSpeed: 0.85,
      horizonAmount: 1.15, horizonScale: 1.25, horizonColor: 0x8d7452,
    },
    ambience: { wind: 0.07, windFreq: 340, drone: 0.10 },
    dust: {
      count: 800, color: 0xd0bc94, opacity: 0.24, size: 22,
      // A bowl ringed by stone is sheltered: the fronts that cross the dune sea
      // arrive here broken up, so the arena's weather is half the strength and
      // twice as frequent — squalls that dust the ring and pass, rather than a
      // wall that swallows the level.
      weather: { peak: 0.62, period: 86, duration: 30, fogGain: 3.0, windGain: 1.9, unrest: 0.20 },
    },
    // Dry scrub in the sand — the stuff that grows in a place people only visit
    // to kill each other in. Thin: this floor is fought on.
    // NO GRASS. "A bowl of sand ringed by stone", by its own blurb. The one
    // level whose whole subject is what happened on its floor now keeps a
    // record of it: the longest-lived print of any sand level, because a
    // wind-packed silt pan holds a mark the way loose dune sand does not.
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 23);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      // ── Mesas behind the ring, at three ranges. The atmosphere block already
      // says the arena sits INSIDE a landscape; this is the geometry that makes
      // that true rather than painted, because it moves as you cross the bowl.
      // Measured before choosing these: the arena's own heightfield already
      // climbs from -0.8 m at the centre to 64 m of rim at 172 m out. So the
      // ranges are DELIBERATELY lower here than on the dune sea — they stand
      // on top of a bowl wall that is doing most of the enclosing already, and
      // the dune sea's numbers would have put a 29° wall of stone all the way
      // round the sky.
      addHorizon(world, {
        seed: 4402,
        layers: [
          { radius: 176, low: 11, high: 26, shade: 0.52 },
          { radius: 254, low: 20, high: 46, shade: 0.60 },
          { radius: 348, low: 34, high: 76, shade: 0.70 },
        ],
      });

      /* ── THE PERISTYLE, and it is the level.
       *
       * FOURTEEN COLUMNS, NOT THIRTY-SIX BAYS. The rhythm of a monumental
       * order is slow — an intercolumniation of four to six diameters, which
       * at a 2.3 m shaft is 20 to 28 m — and that slowness is most of what
       * says "colossal" from inside the sanctum: at 36 bays the eye reads a
       * fence, at 14 it has to travel from one shaft to the next and the
       * travelling is the scale.
       *
       * TWO TO AN ISLAND, and the arithmetic is the same one the temple's
       * colonnade derives: a 30 m column plus its plinth, entablature block
       * and fallen drum is four or five separate emits, so fourteen of them
       * placed singly is roughly 60 emits and 90 draw calls out of a budget of
       * 520 that this level was already spending 411 of. Merged in pairs it is
       * seven emits. The pair straddles the gap rather than sitting on it, so
       * what merges is a column, the ARCHITRAVE that spans to its neighbour,
       * and that neighbour — which is genuinely one piece of building.
       *
       * `flutes: 0` and `volutes: false`: this is not a classical order. A
       * fluted shaft with a scrolled capital reads as Greek, and what the note
       * asks for is ALIEN — so the shafts are plain monoliths with a heavy
       * square abacus, which is the one profile that reads as enormous rather
       * than as ornate, and the ornament is in the entablature instead.
       */
      /* SIXTEEN STATIONS, twelve of which carry a column and four of which are
       * the gates the horde walks out of. The gates are ON the order's own
       * rhythm rather than cut into the gaps between it, and that is not
       * tidiness: at fourteen stations with the gates at their own four
       * angles, the gate pylons landed 12.3 m from the nearest shaft and their
       * stone stood inside it. A processional gateway is a bay of the
       * peristyle built taller and opened up, which is what a temple front
       * actually is.
       *
       * Which columns have gone: a ruin that fails at random reads as damage;
       * one that fails in a RUN reads as a collapse — something came through
       * the south-west and took three consecutive bays of the order and their
       * entablature with it, and one more shaft went on its own. */
      const R = 62, N = 16;
      const GATE = new Set([2, 6, 10, 14]);
      const DOWN = new Set([4, 11, 12, 13]);

      /* ONE ISLAND PER COLUMN, with the architrave living in the island of the
       * shaft at its LEFT end. Merging the pair instead was tried and it costs
       * half as many emits — but `occupancy` records a merged mesh as one box
       * at its own half-width, so a pair whose architrave has gone would have
       * claimed a 17 m radius of "something within reach" over 28 m of empty
       * sand between two columns. Attached to one end, the box the survey sees
       * is either a column (6 m) or a column and the beam that genuinely spans
       * away from it, and both of those are true. */
      const span = 2 * Math.sin(Math.PI / N) * R;          // 24.2 m at R = 62
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
        // the island's own frame points at the middle of the bowl, so `local`
        // x runs along the peristyle and z runs in toward the fight
        const yaw = -a + Math.PI / 2;
        if (GATE.has(i)) {
          /* THE GATE, at the scale of the order. A 7.5 m arch under a 30 m
           * colonnade is a cat flap; this is a 20 m opening under a 26 m
           * entablature, which is a door for the thing the temple was built
           * around rather than for a person. */
          /* 17 m of opening under a 22 m entablature — still four times the
           * arch it replaced, and 30% cheaper than the 20 × 26 first written:
           * the maker builds pylons, a voussoir ring, chains, a banner and its
           * own rubble, all of it tessellated to 1.15 m, so a gate's triangle
           * count goes with its AREA and four of them at 20 × 26 came to 98k.
           * `debris` and `drift` off because the loop below lays its own. */
          addRuinedGate(world, at(cx, cz), {
            span: 17, height: 22, yaw, seed: 4600 + i,
            mat: M.duracreteWarm, trimMat: M.sandstone, broken: i === 10 ? 0.55 : 0.22,
            debris: false, drift: false,
          });
          addDebrisField(world, at(cx, cz), { radius: 13, seed: 4460 + i, count: 22 });
          continue;
        }
        const gone = DOWN.has(i);
        // The architrave reaches the NEXT shaft, and only where both ends of it
        // are still there to carry it — that is the whole reason a collapse
        // propagates along a colonnade rather than stopping at one bay.
        const nxt = (i + 1) % N;
        const carries = !gone && !DOWN.has(nxt) && !GATE.has(nxt);
        island(world, at(cx, cz), { seed: 4400 + i, yaw, span: carries ? span * 1.05 : 6.5, maker: 'peristyle' },
          (kit, local) => {
            addColumn(world, local(0, 0), {
              kit, height: 30, radius: 2.3, seed: 4410 + i, mat: M.duracreteWarm,
              // 13 sides on a 4.6 m shaft is 1.1 m of chord — under the width
              // of the outline pass's own stroke at the range you see it from
              trimMat: M.sandstone, flutes: 0, volutes: false, seg: 13,
              // a snapped 30 m shaft still leaves 9-15 m of stump standing,
              // which is taller than the wall it replaced
              standing: gone ? 0.30 + rng() * 0.20 : 1,
            });
            if (carries) {
              // the bay runs anticlockwise in world space, which is -x in the
              // island's frame; the beam is drawn from the shaft to the next
              kit.slab(M.sandstone, span, 2.6, 4.4, -span / 2, 31.4, 0, { tile: 2.4, seg: 5, collide: false });
              kit.slab(M.duracreteDark, span, 1.1, 5.2, -span / 2, 33.3, 0, { tile: 2.4, seg: 5, collide: false });
            }
          });
        /* …and what fell off it, banked at the foot where it landed. Every
         * OTHER station: at all sixteen this was 288 separate broken stones
         * round a ring the player only ever sees a third of at a time, and it
         * cost 60k triangles for rubble that reads identically at half the
         * count. */
        if (i % 2 === 0) addDebrisField(world, at(cx, cz), { radius: 12, seed: 4460 + i, count: 14 });
      }

      /* ── NO TEMENOS WALL, and it is a decision rather than an omission.
       *
       * A precinct wall standing behind the order was built, measured and
       * taken out again. What it was for is real — a colonnade seen against
       * open sky is a row of sticks, and seen against a wall it is a building
       * with depth — but this level already has the wall: its own heightfield
       * climbs from −0.8 m at the centre to 27 m of rim at 116 and 64 m at
       * 172, so every column stands against forty metres of bedded stone
       * whichever way you look. The wall was a second copy of that, and it was
       * the most expensive thing on the level: measured by ablation, six
       * segments of 38 × 13 m came to 66k triangles of 510k, because
       * `weatherGeo` tessellates every surface to 1.15 m vertices and a wall
       * is nothing but surface.
       *
       * The frame budget is the reason it was measured and the composition is
       * the reason it stayed out.
       */

      /* ── THE GUARDIANS. Four hooded colossi facing in over the floor, at 34
       * and 30 m — taller than the order they stand between, which is what a
       * cult statue is for. Three of them are wrecked; one is not, and the one
       * that is not is the thing your eye goes to from anywhere in the bowl.
       *
       * Set at r = 46 rather than against the wall: a statue at the rim is
       * scenery, and a statue you can be driven into the feet of is cover. */
      /* THREE STANDING AND ONE DOWN, not four and one. A guardian is 13k
       * triangles and the frame's budget is the reason there is not one on
       * every quarter — which is also the better composition: three round a
       * ring reads as what is LEFT of a set, and four reads as a complete
       * one. */
      const guardians = [[0.42, 34, true], [0.42 + TAU / 3, 30, true],
                         [0.42 + TAU * 2 / 3, 34, false]];
      for (let i = 0; i < guardians.length; i++) {
        const [a, h, ruined] = guardians[i];
        const cx = Math.cos(a) * 46, cz = Math.sin(a) * 46;
        /* `seg: 13`, not the maker's default 20. Every one of these is a
         * revolve — robe, torso, mantle, cowl — so the segment count multiplies
         * through four lathes and fourteen fold ridges apiece. At 34 m the
         * silhouette is what carries and a 13-sided revolve is under a degree
         * of error on it; measured, the drop is 22k triangles a statue. */
        addColossus(world, at(cx, cz), { height: h, yaw: -a + Math.PI, seed: 4700 + i, ruined, seg: 13 });
        addDebrisField(world, at(cx, cz), { radius: 14, seed: 4710 + i, count: 26 });
        siteOk(world, cx, cz, { clearance: 15, spawnClear: 0 });
      }

      /* ── THE FIFTH GUARDIAN, down. It fell across the floor and it is the
       * one piece of architecture the fight is actually inside: a 26 m shaft
       * of a body lying on its side, the head off it, and the hand it was
       * holding out. This is the level's landmark, and it is off-centre so the
       * middle of the bowl stays clear to fight in.
       *
       * `standing: 0.13` on a colossal drum is `addColumn`'s stump-and-shaft
       * case: what you get is a broken base with the shaft lying beside it,
       * which is exactly the shape of a toppled statue's plinth and torso and
       * costs one emit rather than a bespoke maker. */
      addColumn(world, at(-24, 14), {
        height: 30, radius: 2.6, yaw: 2.1, seed: 4800, standing: 0.13,
        mat: M.sandstone, flutes: 0, volutes: false,
      });
      addColossus(world, at(-31, 22), { height: 22, yaw: 2.1, seed: 4801, ruined: true, seg: 13 });
      addDebrisField(world, at(-27, 18), { radius: 18, seed: 4802, count: 34 });
      addScree(world, at(-27, 18), { radius: 22, count: 420, size: 0.72, seed: 4803, mat: M.stone });

      /* ── THE ALTAR, at the focus. Whatever was worshipped here stood on
       * this, and the reason the place is a killing floor is that somebody
       * decided it was a good stage. Off the exact centre by 9 m: the middle
       * of a duelling floor belongs to the duel. */
      island(world, at(8, -7), { seed: 4900, yaw: 0.6, span: 15, maker: 'altar' },
        (kit, local) => {
          addPlinth(world, local(0, 0), { kit, width: 9.5, depth: 9.5, height: 2.2, steps: 3,
            mat: M.sandstone, bandMat: M.duracreteDark });
          // the ring that stood on it, broken in half and lying where it fell
          for (const [dx, dz, ry] of [[-5.5, 3.2, 0.5], [4.8, -4.4, 2.3]]) {
            kit.slab(M.duracreteWarm, 8.5, 1.5, 1.6, dx, 0.8, dz, { tile: 2.4, seg: 4, ry });
          }
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + 0.4;
            addColumn(world, local(Math.cos(a) * 6.4, Math.sin(a) * 6.4), {
              kit, height: 11, radius: 0.9, seed: 4910 + i, mat: M.sandstone,
              flutes: 0, volutes: false, standing: i === 1 ? 0.34 : i === 3 ? 0.52 : 1,
            });
          }
        });

      // ── Rock spilling in where the bowl wall has come down onto the
      // precinct, and the debris of a place that has been fought in before.
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 34, 56, { clearance: 9, maxSlope: 0.5 });
        if (!site) continue;
        addOutcrop(world, site.pos, { size: 4.5 + rng() * 2.5, seed: 900 + k });
        addScree(world, site.pos, { radius: 9, count: 90, seed: 910 + k });
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 16, 44, { clearance: 7 });
        if (site) addDebrisField(world, site.pos, { radius: 7, seed: 950 + k, count: 16 });
      }

      // ── Loose, cuttable cover. Stacked, not sprinkled: crates arrive in
      // stacks because someone stacked them.
      for (let k = 0; k < 5; k++) {
        const site = findSite(world, 13, 42, { clearance: 3.5 });
        if (site) addCrateStack(world, site.pos, { seed: 970 + k, height: 2 + (rng() < 0.4 ? 1 : 0) });
      }
      for (let i = 0; i < 12; i++) {
        const site = findSite(world, 12, 46, { clearance: 2.6 });
        if (!site) continue;
        world.addProp(rng() < 0.3
          ? makeBarrel(world, site.pos)
          : makeCrate(world, site.pos, 0.75));
      }

      // ── The sand of the bowl itself. Nothing here takes a collider, because
      // this is the floor of the fight and a shin-high rock you cannot see past
      // your own blade is worse than bare ground. Purely what the eye reads.
      strewGround(world, { seed: 3302, radius: 108, inner: 4, boulders: 0.85 });

      // ── Rubble banked against the foot of the order, where fourteen thirty
      // metre columns' worth of fallen masonry would actually be. A wall
      // standing on clean sand is a wall that was put there this morning. Five
      // arcs of it rather than one per bay: each covers 72° of the
      // circumference, and five instanced calls buy what fourteen would have
      // cost in draw calls.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.21;
        addScree(world, at(Math.cos(a) * (R - 4) * 0.62, Math.sin(a) * (R - 4) * 0.62),
          { radius: R - 2, inner: R * 0.62, count: 430, size: 0.62, seed: 3400 + i,
            // banked where the bays actually fell in, not evenly round the ring
            field: stoneField(world) });
      }

      /* ── FALLEN DRUMS across the floor, and they are the size band this
       * level's floor is now missing rather than the one it used to miss.
       *
       * A 30 m shaft comes down as eight drums 2.3 m across and nearly 4 m
       * long, each one a boulder somebody quarried. `standing` under about 0.4
       * is `addColumn`'s stump-with-its-shaft-beside-it case, and at radius 1.9
       * what it leaves lying in the sand is a cylinder you have to go round —
       * cover at the scale of the building rather than a kerb.
       */
      for (let k = 0; k < 8; k++) {
        const site = findSite(world, 22, 56, { clearance: 9, maxSlope: 0.4, tries: 20 });
        if (!site) continue;
        addColumn(world, site.pos, {
          height: 13 + rng() * 8, radius: 1.5 + rng() * 0.6,
          yaw: rng() * TAU, seed: 3500 + k, standing: 0.14 + rng() * 0.20,
          mat: M.sandstone, flutes: 0, volutes: false,
        });
      }
      for (let k = 0; k < 2; k++) {
        const site = findSite(world, 24, 52, { clearance: 7, maxSlope: 0.35, tries: 20 });
        if (site) addPlinth(world, site.pos, { width: 2.6 + rng() * 1.6, height: 1.1 + rng() * 0.7, seed: 3600 + k });
      }

      // ── And outside the peristyle: the ground the horde walks in over. It
      // was completely bare, which is what you saw through every broken bay.
      strewGround(world, { seed: 3303, radius: 165, inner: 68, boulders: 1.1, grit: 0.3 });
      strewWrecks(world, { count: 4, rmin: 74, rmax: 168, seed: 2640 });
      // Two groups, not four: `addRock` is a draw call apiece and the instanced
      // landmark grade inside strewGround already covers this ground. These are
      // here for SHAPE — a few hand-sized-to-house-sized rocks with real
      // silhouettes among the instanced ones — not for coverage.
      for (let g = 0; g < 2; g++) {
        cluster(world, { rmin: 66, rmax: 165, count: 7, spread: 13, falloff: 0.6,
          satClearance: 2.2, maxSlope: 0.55, tries: 20 }, (pos, i2, d) => {
          const sz = lerp(3.0, 0.6, clamp(d / 13, 0, 1)) * (0.7 + rng() * 0.6);
          addRock(world, pos.clone().setY(pos.y + sz * 0.2),
            new THREE.Vector3(sz * 1.5, sz * 1.05, sz * 1.3), 3700 + g * 13 + i2);
        });
      }
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 74, 168, { clearance: 11, maxSlope: 0.5, tries: 20 });
        if (site) addBoulderCluster(world, site.pos, { radius: 9, count: 11, size: 1.5, seed: 5600 + k });
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 86, 170, { clearance: 16, maxSlope: 0.55, tries: 24 });
        if (site) addOutcrop(world, site.pos, { size: 7 + rng() * 5, seed: 3800 + k });
      }
      world.notify('THE SANCTUM', 'it was holy once');
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  MUSTAFAR
   *
   *  "Real lava, Revenge of the Sith, built as a duelling map."
   *
   *  Three things had to be true for that to be more than an orange filter.
   *
   *  THE LAVA IS REAL AND IT IS A LEVEL SURFACE. It is the game's own `Water`
   *  with a different set of colours, and that is not a cheat — `waterShade`
   *  is an ANALYTIC shader. It computes its body colour from `uShallow` and
   *  `uDeep` and never multiplies by a light, so on a level with almost no
   *  key light the sea comes out at exactly the radiance it is authored at
   *  while the rock around it goes black. That is what self-luminous means
   *  here, and it comes with the depth bake, the shoreline band and the
   *  ripples already written. A hand-rolled emissive plane would have had to
   *  re-derive all three and would still not have known where the shore was.
   *
   *  THE ROCK IS COLD. Rule 5 of the art direction: one hue family and one or
   *  two saturated accents, and the accent IS the subject. Every warm pixel on
   *  this level is lava, or something the lava is lighting. The basalt is
   *  authored at 232° — a blue-charcoal — because a warm rock under an orange
   *  sea leaves the orange nothing to be an accent against, and the level
   *  becomes one wash. The measurement that matters is in the preset.
   *
   *  IT IS A DUELLING MAP, which is a shape and not a mood: a shelf with a
   *  clear middle to circle in, cover at the edges rather than in the centre,
   *  and a coastline you can be driven onto from three sides.
   * ═════════════════════════════════════════════════════════════════════ */

  mustafar: {
    name: 'Mustafar',
    blurb: 'A basalt shelf standing out of a lava sea, under an ash fall. Nothing here is neutral ground.',
    terrain: 'mustafar',
    // A duelling map wants blades in it. The pool is weighted to the one
    // sabered archetype this game has and thinned of hordes: half of what
    // walks out of the ash is something that will meet your guard.
    pool: ['acolyte', 'acolyte', 'b2', 'droideka', 'acolyte', 'trooper', 'b1', 'sniper'],
    groundColor: 0x50443c,
    spawnRadius: [26, 48],
    /**
     * THE SEA. `level` sits 0.55 above the datum, which is where the preset's
     * flow lobes drown — so the coastline is drawn by the LANDFORM and comes
     * out with bays, headlands and a couple of stacks left standing offshore,
     * rather than as a circle cut round the fight.
     *
     * The four colours are a two-tone ramp with the boundary in the right
     * place, exactly as rule 1 asks: a bright orange skin, a dark red body a
     * metre down, and a bed so dark that where the sheet is thin you read
     * CRUST rather than shallow lava. `sky` is what the surface mirrors, and
     * on this level the sky really is that colour.
     */
    water: { level: 0.55, shallow: 0xff8a1e, deep: 0x76140a, sky: 0xdc4206, bed: 0x140d10 },
    atmosphere: {
      /* A sky made of smoke: turbidity and mie up, rayleigh down — mie is
       * forward scatter off big particles, which is what ash is, and rayleigh
       * is what makes a sky blue, of which there is none on this level.
       *
       * DOWN, NOT OFF, and the difference is the whole tuning story. Written
       * first at rayleigh 0.55 the physical model returned so little radiance
       * that `atmosphereMeter` hit its exposure clamp at 3.0 — and once a level
       * is on the clamp the meter has stopped metering it, so the frame is
       * exposed by an accident of the ceiling rather than by its own light.
       * Four separate checks fell over on that one number: the metered key
       * spread across outdoor levels went from 1.00:1 to 1.41:1, distance
       * converged on a colour brighter than the dome it was converging toward,
       * and the sunward inscatter lobe disappeared entirely. 2.4 keeps the
       * model in range; the ORANGE comes from the sun colour, the cloud deck
       * and the grade, which is where a colour that is not physics belongs.  */
      turbidity: 9.5, rayleigh: 1.6, mie: 0.012, mieG: 0.86,
      /* The flow lobes run along (0.78, 0.62), i.e. 38°. A sun at 128° crosses
       * them, so every levee has a lit face and a shaded one — the same rule
       * the dune sea derives for its dune train, and the same reason.
       *
       * 128 AND NOT 308, which is the same crossing from the other side and
       * measured very differently. The default pose looks down −z, and at 308°
       * the sun's bearing sits 128° away from that — the darkest quarter of
       * the dome — so the sky the player is looking at came out DARKER than
       * the near air standing in front of it, and the far ground overshot past
       * its own sky in luminance between 120 and 200 m. 128° puts the sun 52°
       * off the view axis, which is the same choice the dune sea makes and for
       * the same reason.
       *
       * 15°, and it is the lowest sun in the game on purpose. `lighting.mjs`
       * orders the indirect budget by sun height across every outdoor level
       * strictly — a low sun shines through more air, so more of its beam
       * arrives as sky — and this level genuinely delivers more of its light
       * as sky than any other: 46.1% indirect against the White Pass's 43.0%
       * at 17°, under the 50% cap. A high sun here would be a claim that a
       * smoke column ten kilometres thick is clear. */
      elevation: 15, azimuth: 128,
      /* THE HEMISPHERE CARRIES THIS LEVEL'S SHADE, and it is turned up three
       * times as far as anywhere else in the game for a reason the frame made
       * obvious. The IBL probe is baked from the PHYSICAL sky — Preetham, blue
       * — and on a two-band cel ramp with a 15° sun most of the ground is in
       * the shaded band, so the first render of this level came back LAVENDER
       * from horizon to boots. `ambient` is the one term that can answer that:
       * it is a hemisphere light coloured by this level's own `skyColor`
       * above and `groundColor` below, both authored warm, and — measured —
       * it does not enter the indirect-budget ratio `lighting.mjs` caps at
       * 50% at all (46.1% at ambient 0.30, 0.55, 0.85 and 1.20 alike). What it
       * does move is the shade's colour: B/R 1.85 → 1.22, and the lit-to-shade
       * ratio 2.71 → 2.50 against a floor of 2.39. */
      sunColor: 0xff9a52, sunIntensity: 4.6, ambient: 0.90,
      skyColor: 0xd86c30,
      /* THE HEMISPHERE'S LOWER HALF IS THE ASH, NOT THE BASALT. The rock here
       * is a 0.03-luminance charcoal and authoring that as `groundColor` was
       * wrong twice: it is the colour of the light the GROUND THROWS BACK UP,
       * and what is lying on this ground is a pale ash fall, not bare rock.
       * Measured, the mistake was visible in the cloud deck — `cloudLight`
       * derives a base's bounce term from exactly this swatch, and at 0x2a2126
       * the bounce contributed 0.009 of a 0.23 base against a floor of 10%, so
       * the ash cloud over an ash plain was being lit entirely by itself. */
      groundColor: 0x50443c,
      /**
       * THE FILL IS NOT SKYLIGHT HERE, and that is the one thing about this
       * level's light that is genuinely different from every other.
       *
       * Everywhere else in this game the brightest thing that is not the sun
       * is the sky, so the fill — placed opposite the key — stands for the
       * dome and is blue. On Mustafar the brightest thing that is not the sun
       * is the SEA, the smoke ceiling is lit from below by it, and a blue fill
       * would be a lamp nobody has switched on. `lighting.mjs` used to require
       * B/R > 1.15 of every outdoor fill; that check now asks the stronger
       * question — is the fill the colour of THIS level's own sky — and this
       * is the level that made the difference visible.
       *
       * Chroma scaled about its own luminance the way the dune sea's and the
       * arena's were, for the same reason: lum 0.255, inside the 0.16–0.62 the
       * meter needs, so this reads as a colour decision and not as a dimmer.
       */
      fillColor: 0xc8763c, fillIntensity: 0.72,
      // Smoke, not haze. 0.0095 puts half-light at 73 m, which is what hides
      // the edge of a 460 m heightfield on a level with no painted ranges.
      fogColor: 0x6b3a2a, fogDensity: 0.0095, fogHeight: 30, fogBase: 3,
      /* AUTHORED RATHER THAN DERIVED, and this is the one level in the game
       * that needs to be. `applyAtmosphere` defaults the forward-scatter weight
       * to (sunward skyline − side skyline) × 0.028, which is a good estimate
       * of how much brighter a clear sky is toward the sun — and on a sky this
       * compressed the two samples land within a per cent of each other, so the
       * estimate comes out at essentially zero and the glow switches off. A
       * smoke sky is the case where forward scatter is strongest, not weakest;
       * mie scattering off ash is what makes the sun a disc you can look at. */
      inscatter: 0.050,
      /* THE GRADE IS WHERE THE ORANGE COMES FROM, and it has to be, because
       * the sky model cannot make one. The drawn dome is Preetham: it returns
       * a blue zenith at any turbidity a level can afford (measured across
       * seven parameter sets, B/R at the zenith never fell below 4.2 without
       * putting `atmosphereMeter` on its exposure clamp and breaking four
       * other checks). Physics does not paint a sky orange from the top down —
       * a smoke column does, and a smoke column is not in the model.
       *
       * So the ash ceiling does it, and the grade finishes it. The arena's own
       * block warns that a warm `gain` is what flattened its hue, and that
       * warning is about a level whose subject is a BLUE sky over tan sand;
       * here one hue family is the brief (rule 5), everything in the frame
       * really is lit by fire, and the rock's own albedo is a cold charcoal so
       * warm light on it still reads as cold rock lit warm rather than as warm
       * rock. */
      exposure: 0.92, bloom: 0.50, saturation: 1.10,
      gain: [1.13, 1.00, 0.74],
      // Warm blacks, because on this level the shadows are lit by the floor.
      // Every other level in the game lifts its blacks toward blue for exactly
      // the same reason stated about a sky.
      lift: [0.016, 0.005, 0.002],
      // A ceiling of ash cloud rather than a deck of cumulus: nearly total
      // cover, lit from BELOW, so the lit swatch is the sea's colour and the
      // dark swatch is very dark indeed.
      /* A CEILING, not a deck. 0.96 is the highest coverage in the game by a
       * long way and it is the level's roof: what is over Mustafar is not
       * weather, it is the ash the vents are putting up, and the small amount
       * of sky that shows through it is the only blue this level is allowed. */
      cloudCover: 0.96, cloudLit: 0xff8a30, cloudDark: 0x2e1a16,
      cloudWindDir: 2.32, cloudWindSpeed: 1.9,
      // What the dome meets the ground at: the far shore of the sea, glowing.
      horizonColor: 0x7c3a18,
      /**
       * NO PAINTED RANGES, and it is a decision rather than an omission — the
       * same one the meadow makes and for the opposite reason. The meadow has
       * no ranges because its air hides its edge; this has no ranges because
       * its air hides its edge AND because the thing on this skyline should be
       * SPATTER CONES, which the heightfield builds and the dressing pass
       * stands more of. A painted curtain at 340 m would sit in front of the
       * one silhouette the level is actually about.
       */
      horizon: false,
    },
    ambience: { wind: 0.20, windFreq: 190, drone: 0.26 },
    dust: {
      count: 1500, color: 0x8a7d74, opacity: 0.30, size: 26,
      // Embers. The one warm thing in the air, and the only place on this
      // level where the accent is allowed to be small and everywhere at once.
      fleckColor: 0xff8a30,
      wind: { from: 128, strength: 3.0, gustiness: 0.58, wander: 0.36 },
      // ASH FALL. Mechanically this is the blizzard, which is right: it is a
      // fall that happens in calm air and is raked over by wind. What makes it
      // ash and not snow is that it is dark and it is slow.
      snow: { count: 5200, calm: 0.34, color: 0x6d6560, fall: 0.42, size: 0.16 },
      // A surge off the sea rather than a sandstorm: the fog nearly doubles,
      // the light goes, and the wind barely moves — heat and smoke, not grit.
      weather: { peak: 0.86, period: 108, duration: 40, unrest: 0.20,
                 fogGain: 2.6, windGain: 1.7, sunLoss: 0.74, fillGain: 1.5, tint: 0.94 },
    },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 71);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
      const sea = world.level?.water?.level ?? 0.55;

      // ── Cones. The silhouette of this level, and the only thing on it tall
      // enough to steer by. Rock props rather than painted ranges: they move
      // when you do, they cast, and you can be pushed into one.
      for (let k = 0; k < 16; k++) {
        const site = findSite(world, 24, 104, {
          angle: (k / 7) * TAU + rng() * 0.8, clearance: 13, maxSlope: 0.34,
          minHeight: sea + 1.2,
        });
        if (!site) continue;
        addOutcrop(world, site.pos, {
          size: 3.6 + rng() * 4.4, height: 6 + rng() * 9, seed: 7100 + k, mat: M.stoneDark,
        });
      }
      for (let k = 0; k < 9; k++) {
        const site = findSite(world, 106, 196, { clearance: 18, maxSlope: 0.5, tries: 24 });
        if (site) addOutcrop(world, site.pos, { size: 7 + rng() * 7, height: 14 + rng() * 16, seed: 7130 + k, mat: M.stoneDark });
      }

      // ── The collection plant. Somebody is here for the ore, and a duel
      // needs architecture to be fought through rather than a bare table.
      // Three islands, well apart, each one a tank, a machine bank and the
      // gantry tying them together.
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 30, 74, {
          angle: 1.1 + k * 2.2, clearance: 20, maxSlope: 0.16, minHeight: sea + 1.6, tries: 26,
        });
        if (!site) continue;
        island(world, site.pos, { seed: 7200 + k, yaw: rng() * TAU, span: 17, maker: 'plant' },
          (kit, local) => {
            addTank(world, local(-4.5, 0), { kit, radius: 2.2, height: 7.5, seed: 7210 + k });
            addMachine(world, local(3.5, 2.5), { kit, width: 4.2, height: 3.0, depth: 2.6, seed: 7220 + k });
            addMachine(world, local(3.0, -3.4), { kit, width: 3.0, height: 2.2, depth: 2.0, yaw: 0.5, seed: 7230 + k });
            addPipeRun(world, [
              new THREE.Vector3(-4.5, 6.0, 1.6), new THREE.Vector3(-1.0, 5.6, 2.6),
              new THREE.Vector3(3.5, 3.6, 2.6),
            ], { kit, count: 2, radius: 0.13, seed: 7240 + k });
            addStanchion(world, local(-1.0, 5.6), { kit, height: 6.5, lamp: true, seed: 7250 + k });
          });
        addDebrisField(world, site.pos, { radius: 10, seed: 7260 + k, count: 22 });
      }

      // ── Ore barges that did not make it, half sunk in the clinker. The
      // mid-distance silhouette band, and the cover you actually fight behind.
      strewWrecks(world, { count: 5, rmin: 34, rmax: 150, seed: 7300, maxSlope: 0.34 });
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 30, 110, { clearance: 13, maxSlope: 0.3, minHeight: sea + 0.8 });
        if (!site) continue;
        addHullSection(world, site.pos, { length: 15 + rng() * 9, radius: 3.2, yaw: rng() * TAU, seed: 7320 + k });
      }

      // ── Broken flow front. Where a lobe stopped it left a wall of clinker,
      // and that is the cover at the rim of the shelf.
      for (let k = 0; k < 9; k++) {
        const site = findSite(world, 18, 96, { clearance: 8, maxSlope: 0.55, minHeight: sea + 0.4 });
        if (site) addBoulderCluster(world, site.pos, { radius: 8, count: 13, size: 1.7, seed: 7400 + k, mat: M.stoneDark });
      }

      // ── The clinker itself: this level's ground cover is ash, and what
      // stands up out of it is broken basalt sorted by size like any other
      // loose surface. Heavier than a desert because a flow front sheds more.
      strewGround(world, { seed: 7500, radius: 150, spread: 0.38, mat: M.stoneDark,
        landmarks: 1.4, boulders: 1.5, cobble: 1.5 });

      // ── Loose cover near the middle, deliberately sparse: a duelling floor
      // wants a clear centre and its cover at arm's reach from the edge of it.
      for (let i = 0; i < 9; i++) {
        const site = findSite(world, 20, 52, { bias: 1.6, clearance: 4.5, maxSlope: 0.24, minHeight: sea + 1.0 });
        if (site) world.addProp(rng() < 0.34 ? makeBarrel(world, site.pos) : makeCrate(world, site.pos, 0.85));
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 26, 62, { clearance: 6, maxSlope: 0.22, minHeight: sea + 1.0 });
        if (site) addCrateStack(world, site.pos, { seed: 7600 + k, tiers: 2 + (rng() < 0.4 ? 1 : 0) });
      }
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE TEMPLE
   *
   *  "Jedi Temple / Coruscant — the enemies are Jedi; you are clearing the
   *  temple."
   *
   *  ONE HONEST LIMITATION, stated here rather than hidden in the pool. This
   *  game has exactly one sabered humanoid archetype, `acolyte`, and no Jedi
   *  body: Enemy.js and Bodies.js are where a `jedi` would have to live and
   *  this change may not touch them. So the temple's garrison is acolytes at
   *  three quarters of the pool with a thin screen of shooters behind them,
   *  which fights the way a hall full of blades should fight and does not look
   *  like one. What is needed is written down in the report rather than faked.
   * ═════════════════════════════════════════════════════════════════════ */

  temple: {
    name: 'The Temple Halls',
    blurb: 'The high halls on Coruscant, and everyone still standing in them has a blade.',
    terrain: 'temple',
    pool: ['acolyte', 'acolyte', 'acolyte', 'sniper', 'acolyte', 'trooper', 'acolyte', 'b2'],
    groundColor: 0x4a4438,
    spawnRadius: [28, 50],
    atmosphere: {
      /* AN INTERIOR WITH A SKY OUTSIDE IT. `sky: false` because there is a
       * roof over this room and the dome would draw straight through it; the
       * city beyond the colonnade is `bgColor`, and it is the one cool note in
       * a warm room — which is also the whole composition. Cream stone, and a
       * cold city haze in the gaps between the columns. */
      sky: false, bgColor: 0x3f4a5e, fog: true, fogColor: 0x4a4a4e, fogDensity: 0.0072,
      // A late sun raking the length of the hall through the west colonnade.
      // 16° is what puts a 40 m stripe of light across a floor; anything
      // higher and the columns stop casting across it.
      sunColor: 0xffe2b4, sunIntensity: 5.2, ambient: 0.30,
      skyColor: 0x9fb4d8, groundColor: 0x4a4438,
      // The city, standing in for the sky this room cannot see. Cool, and
      // strong enough to put a terminator on a shoulder in the shade.
      fillColor: 0x6f86b4, fillIntensity: 0.52,
      exposure: 1.02, bloom: 0.40, saturation: 1.04,
      lift: [0.004, 0.006, 0.013], gain: [1.01, 1.0, 1.01],
      clouds: false, horizon: false,
    },
    ambience: { wind: 0.05, windFreq: 220, drone: 0.07 },
    dust: { count: 700, color: 0xd8cbb0, opacity: 0.20, size: 20 },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 73);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      /* The coffered ceiling of the hall, twenty metres up. Without it the
       * top third of every frame in here is the flat `bgColor` — a hall with
       * an infinite black ceiling reads as a courtyard at night. It does not
       * cast: the late sun that rakes the length of this hall comes in almost
       * horizontally through the colonnade, and a roof that cast would simply
       * delete it. */
      roof(world, { height: 20, half: 66, mat: M.duracreteDark, beamCount: 11, thickness: 2.0 });

      /* ── THE COLONNADES. Two of them, down the long axis, and they are the
       * level. A hall reads as a hall because of the rhythm of its columns and
       * because the light comes between them — so the spacing is exact (8 m
       * bays, surveyed, no jitter) and the ruin is not: every seventh column
       * has come down, and the ones that have taken their lintel with them. */
      /* Three bays to an island, and the reason is arithmetic rather than
       * taste: fifteen columns a side plus their entablature is 56 separate
       * emits and roughly 90 draw calls, against a level budget of 520 that
       * this room was measured at 504 of. Merged three at a time it is ten
       * emits and thirty, the colonnade still reads as one continuous run to
       * the occupancy survey — which it IS — and nothing about the rhythm
       * moves, because the bay pitch is still exactly 8 m. */
      const BAY = 8, GROUPS = 5, HALF = 26;
      for (let g = 0; g < GROUPS; g++) {
        const z0 = (g - (GROUPS - 1) / 2) * BAY * 3;
        for (const sx of [-1, 1]) {
          island(world, at(sx * HALF, z0), { seed: 8100 + g * 3 + sx, span: 26, maker: 'colonnade' },
            (kit, local) => {
              for (let b = -1; b <= 1; b++) {
                const z = b * BAY;
                const fallen = ((g * 3 + b + 4) * 5 + (sx > 0 ? 2 : 0)) % 11 < 2;
                addColumn(world, local(0, z), {
                  kit, height: 11.5, radius: 0.86, seed: 8110 + g * 7 + b * 2 + sx,
                  mat: M.sandstone, standing: fallen ? 0.28 + rng() * 0.22 : 1,
                });
                // the entablature, spanning bay to bay above the shafts
                if (b < 1 && !fallen) {
                  kit.slab(M.sandstone, 1.5, 1.1, BAY, 0, 12.2, z + BAY / 2, { tile: 2.4, seg: 3 });
                }
              }
            });
          // the aisle wall behind the colonnade, with the city showing through
          addBrokenWall(world, at(sx * (HALF + 9), z0), V(BAY * 3 - 0.6, 9.5, 1.6), {
            yaw: Math.PI / 2, seed: 8200 + g * 2 + sx, mat: M.duracreteWarm,
            ruin: g === 2 ? 0.72 : 0.22,
            openings: [{ x: -6, y: 1.8, w: 3.2, h: 5.4, arched: true },
                       { x: 6, y: 1.8, w: 3.2, h: 5.4, arched: true }],
          });
        }
      }

      /* ── THE DAIS at the end of the hall, which the heightfield already
       * raises: the stair is what makes it read as a threshold rather than as
       * a bump, and it is where the last of a wave backs up to. */
      addStair(world, at(4, -21), { width: 14, steps: 5, rise: 0.28, run: 0.9, yaw: 0, railing: false, mat: M.sandstone });
      addRuinedGate(world, at(4, -46), { width: 13, height: 12, seed: 8300 });
      addColossus(world, at(-9, -40), { height: 15, yaw: 0.5, seed: 8310, ruined: true });
      addColossus(world, at(17, -40), { height: 15, yaw: -0.5, seed: 8320, ruined: false });
      addDebrisField(world, at(-9, -40), { radius: 9, seed: 8330, count: 22 });

      /* ── The far end: a broken wall where whatever came through, came
       * through, and the rubble it made. */
      addBrokenWall(world, at(0, 52), V(34, 12, 2.2), {
        yaw: 0, seed: 8400, mat: M.duracreteWarm, ruin: 0.78,
        openings: [{ x: -8, y: 0, w: 5.5, h: 7.5, arched: true }, { x: 9, y: 0, w: 4.5, h: 6.5, arched: true }],
      });
      addScree(world, at(0, 47), { radius: 24, count: 420, size: 0.55, seed: 8410, mat: M.stone });

      /* ── The rest of the precinct. Everything below is here to answer the
       * one bar an interior with no ground cover has to clear on its objects
       * alone — a median gap to the nearest thing under 6.5 m over a 132 m
       * room — and every piece of it is something a temple would have. */

      /* ── THE PRECINCT WALL, right out at the room's edge. Measured before it
       * was added: 17.1% of the walkable floor had nothing within twelve
       * metres, and all of it was the outer ring — the nave and its chapels
       * are dense and everything past |x| = 40 was bare flagging. A hall this
       * size has an ambulatory round it, so that is what this is. */
      const PR = 58, arcs = 18;
      for (let i = 0; i < arcs; i++) {
        const a = (i / arcs) * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        const k = 1 / Math.max(Math.abs(c), Math.abs(s));
        const x = c * k * PR, z = s * k * PR;
        const yaw = Math.abs(c) > Math.abs(s) ? 0 : Math.PI / 2;
        const gone = (i * 7 + 1) % 9 < 2;
        island(world, at(x, z), { seed: 8900 + i, yaw, span: 16, maker: 'ambulatory' },
          (kit, local) => {
            addBrokenWall(world, local(0, 0), V(15.0, gone ? 3.6 + rng() * 2 : 8.5, 1.8), {
              kit, mat: M.duracreteWarm, ruin: gone ? 0.72 : 0.24, seed: 8910 + i,
              openings: i % 3 === 1 ? [{ x: 0, y: 0, w: 3.6, h: 5.0, arched: true }] : undefined,
            });
            // and the ambulatory columns standing in front of it
            addColumn(world, local(0, -7), {
              kit, height: 8.5, radius: 0.62, seed: 8940 + i, mat: M.sandstone,
              standing: gone ? 0.3 + rng() * 0.3 : 1,
            });
          });
      }

      // Side chapels and their plinths, on the surveyed bay grid.
      bay(world, { nx: 5, nz: 5, pitch: 25, x: 0, z: 4, jitter: 3.6, skip: 0.10,
        clearance: 7.5, spawnClear: 10, maxSlope: 0.3 }, (pos, i, j, r) => {
        if (Math.abs(pos.x) < 20 && Math.abs(pos.z) < 20) return;    // keep the nave open
        if (r < 0.42) {
          addPlinth(world, pos.clone(), { width: 2.4 + rng() * 1.4, height: 1.2 + rng() * 0.8, seed: 8500 + i * 7 + j });
        } else if (r < 0.72) {
          addColumn(world, pos.clone(), {
            height: 7 + rng() * 3, radius: 0.55, seed: 8520 + i * 7 + j, mat: M.sandstone,
            standing: rng() < 0.35 ? 0.3 + rng() * 0.3 : 1,
          });
        } else {
          island(world, pos.clone(), { seed: 8540 + i * 7 + j, yaw: rng() * TAU, span: 9, maker: 'shrine' },
            (kit, local) => {
              addPlinth(world, local(0, 0), { kit, width: 3.0, height: 1.5, seed: 8560 + i * 7 + j });
              addColumn(world, local(-2.6, 1.6), { kit, height: 5.4, radius: 0.42, mat: M.sandstone, seed: 8570 + i });
              addColumn(world, local(2.6, -1.6), { kit, height: 5.4, radius: 0.42, mat: M.sandstone, seed: 8580 + j });
            });
        }
      });

      // Fallen masonry across the floor: the size band between litter and
      // architecture, and the one an empty room is always missing.
      for (let k = 0; k < 16; k++) {
        const site = findSite(world, 14, 74, { clearance: 5.5, maxSlope: 0.4, tries: 22 });
        if (!site) continue;
        addColumn(world, site.pos, {
          height: 6.5 + rng() * 3, radius: 0.5 + rng() * 0.24, yaw: rng() * TAU,
          seed: 8600 + k, standing: 0.10 + rng() * 0.18, mat: M.sandstone,
        });
      }
      for (let k = 0; k < 10; k++) {
        const site = findSite(world, 16, 76, { clearance: 7, maxSlope: 0.4, tries: 20 });
        if (site) addDebrisField(world, site.pos, { radius: 8, seed: 8650 + k, count: 20 });
      }
      // and the dust of it, banked where the drifts field says it collected
      strewGround(world, { seed: 8700, radius: 78, inner: 4, spread: 0.30, mat: M.stone,
        landmarks: 1.1, boulders: 1.3, cobble: 1.4 });

      // Braziers along the nave. The only lights in the room that are not the
      // sun coming through the colonnade, and the only saturated thing that is
      // not a blade.
      for (let i = -3; i <= 3; i++) {
        for (const sx of [-1, 1]) {
          addLamp(world, at(sx * 15, i * 14 + 2), {
            height: 3.4, seed: 8800 + i * 2 + sx, light: i % 2 === 0,
            color: 0xffb45a, intensity: 13, distance: 20,
          });
        }
      }
      world.notify('THE TEMPLE HALLS', 'they will not stand aside');
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE DESCENT — three rooms, four rungs
   *
   *  See Run.js for the ladder itself. What matters here is that these three
   *  levels are one BUILDING seen at three depths, and the thing that says so
   *  is not a story, it is the palette: the works, the foundry and the cut all
   *  paint their ground out of the same cold blue-grey family, and everything
   *  that differs between them is LIGHT.
   *
   *  The intake is lit by a hole in the roof. The foundry is lit by what is in
   *  the canal. The cut is lit by whatever is still working — and on the last
   *  rung, by nothing at all.
   * ═════════════════════════════════════════════════════════════════════ */

  intake: {
    name: 'The Intake',
    blurb: 'Where the ore came in. The roof is open to the sky, and it is the last sky there is.',
    terrain: 'works',
    pool: ['b1', 'b1', 'trooper', 'b2', 'droideka', 'sniper', 'b1'],
    groundColor: 0x30363f,
    spawnRadius: [28, 50],
    atmosphere: {
      /* 0.0042, NOT 0.0105. Interiors take their fog swatch as authored —
       * `hazeRadiance` returns early on `sky: false` — so an indoor density
       * is a straight visibility number, and 0.0105 puts half-light at 66 m in
       * a room only 132 m across: the first render of this hall was a blue
       * wash with the far half of its own plant dissolved out of it. A hall
       * you cannot see the end of is not big, it is empty. */
      sky: false, bgColor: 0x11161f, fog: true, fogColor: 0x1a222e, fogDensity: 0.0042,
      // A near-vertical key: this is daylight down a shaft, so it comes almost
      // straight down and everything in the room stands in its own hard pool
      // of shadow. 74° is the steepest sun anywhere in the game and it is the
      // whole reason the room reads as being under something.
      sunColor: 0xd6e6ff, sunIntensity: 5.6, ambient: 0.78,
      skyColor: 0x5f7ba8, groundColor: 0x30363f, elevation: 74, azimuth: 36,
      // What the floor throws back up, plus the working lights: cold, because
      // everything in this room is cold except the hazard lamps.
      fillColor: 0x3a4a62, fillIntensity: 0.62,
      exposure: 1.16, bloom: 0.44, saturation: 0.98,
      lift: [0.005, 0.007, 0.012], gain: [0.99, 1.0, 1.04],
      clouds: false, horizon: false,
    },
    ambience: { wind: 0.06, windFreq: 210, drone: 0.15 },
    dust: { count: 620, color: 0xa8b6c8, opacity: 0.20, size: 18 },
    grass: 0,
    dress(world) {
      beginDressing(world, 20250805 + 81);
      works(world, {
        seed: 8100, lampColor: 0xffb04a, lampEvery: 3, lights: true,
        // THE HOLE IN THE ROOF, and it is the level's whole subject: a 60 m
        // slot with a 74° sun through it lays a hard-edged stripe of daylight
        // across the floor and leaves the rest of the hall to the lamps.
        well: 30,
        crates: 26, stacks: 6, wrecks: 2, banner: 'THE INTAKE',
        note: 'the way down is at the far end of the floor',
      });
    },
  },

  foundry: {
    name: 'The Foundry',
    blurb: 'A canal of melt across the floor, crossed twice. It lights the room and it does not care who is standing in it.',
    terrain: 'foundry',
    pool: ['b1', 'b2', 'b2', 'droideka', 'trooper', 'acolyte', 'sniper', 'b1'],
    groundColor: 0x3a2a24,
    spawnRadius: [30, 52],
    /**
     * The melt, at −1.45: the canal bed is −2.2, so there is three quarters of
     * a metre of it in the bottom and the banks stand clear. Same shader, same
     * argument as Mustafar's sea — analytic, so it is the one thing in a very
     * dark room that has its own radiance.
     */
    water: { level: -1.45, shallow: 0xffc24a, deep: 0x8f2a04, sky: 0xffb04a, bed: 0x1a1010 },
    atmosphere: {
      sky: false, bgColor: 0x0f0b0a, fog: true, fogColor: 0x2a1712, fogDensity: 0.0072,
      // The key is a low, dim, warm thing — the glow off the canal reaching the
      // far wall — and it is deliberately weak, because on this level the light
      // that matters is the FILL: a lamp under the room, pointed up out of the
      // floor, which is exactly what a channel of molten metal is.
      sunColor: 0xffb070, sunIntensity: 2.4, ambient: 0.20,
      skyColor: 0x5a3a30, groundColor: 0x3a2a24, elevation: 21, azimuth: 130,
      fillColor: 0xff7a2c, fillIntensity: 1.05,
      exposure: 1.10, bloom: 0.54, saturation: 1.08,
      lift: [0.016, 0.006, 0.004], gain: [1.03, 1.0, 0.97],
      clouds: false, horizon: false,
    },
    ambience: { wind: 0.04, windFreq: 140, drone: 0.30 },
    dust: { count: 900, color: 0x7a5a4a, opacity: 0.26, size: 22, fleckColor: 0xff9a40 },
    grass: 0,
    dress(world) {
      beginDressing(world, 20250805 + 83);
      works(world, {
        seed: 8300, lampColor: 0xff7a20, lampEvery: 4, lights: true, hot: true,
        crates: 18, stacks: 4, wrecks: 3, banner: 'THE FOUNDRY',
        note: 'the melt is not cover',
      });
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE WARSHIP
   *
   *  "All droids — b1, b2, droideka, and the walker if it fits. The opening of
   *   Revenge of the Sith: corridors, a hangar, a bridge. A boss at the end."
   *
   *  THE POOL IS DROIDS AND NOTHING ELSE, and it is the first level in the
   *  game of which that is true. Every other roster has clone troopers and
   *  marksmen in it because they are the bodies that shoot straight and make a
   *  wave dangerous at range; a Separatist ship has neither, and taking them
   *  away changes the fight rather than just the costume. What replaces the
   *  marksman's pressure is VOLUME — a B1 costs 1 threat against a marksman's
   *  3.2, so the same budget buys three times the bodies — and what replaces
   *  the trooper's grenade is the droideka, which arrives at wave 6 and is a
   *  problem you have to solve rather than one you can walk away from.
   *
   *  THE BOSS IS REGISTERED FROM HERE, at the bottom of this file, beside the
   *  arrival table and for exactly the reason stated there: a level and the
   *  thing at the end of it are one decision. It is not in `unlockedAt`, so it
   *  can never arrive as fill — it is a SET-PIECE, which means it comes on the
   *  boss wave and it comes to the bridge.
   *
   *  THE SHIP IS ONE HEIGHTFIELD, which is the honest limitation, and the
   *  `warship` preset's own comment says what was done about it: the three
   *  spaces are strung along one spine at three levels rather than stacked as
   *  decks, because this engine has no floors and the gait solver, the nav and
   *  the spawn picker all assume it does not.
   * ═════════════════════════════════════════════════════════════════════ */

  warship: {
    name: 'The Invisible Hand',
    blurb: 'A Separatist flagship with its bridge still lit. Everything aboard is a machine, and all of it is between you and the front.',
    terrain: 'warship',
    // Droids only. `unlockedAt` still gates them — b1 from the first wave, b2
    // at 3, droideka at 6, the walker at 12 — so the opening of this level is
    // a corridor full of B1s, which is exactly the right opening.
    pool: ['b1', 'b1', 'b1', 'b2', 'droideka', 'b2', 'b1', 'walker', 'bodyguard'],
    groundColor: 0x2a3038,
    spawnRadius: [26, 52],
    atmosphere: {
      /* `sky: false`: there is a hull over this. `bgColor` is what shows
       * through the launch bay mouth and the bridge viewport, and it is the
       * one cold saturated thing on the level — a battle happening outside,
       * seen from inside a dark ship. 0.0052 puts half-light at 133 m, which
       * is most of the length of the spine: you can see the far end of the
       * ship, and it is a long way off. */
      sky: false, bgColor: 0x14304e, fog: true, fogColor: 0x16212e, fogDensity: 0.0052,
      /* The key comes in through the launch bay mouth on the port side, low
       * and cold: the only daylight aboard is a star. 12° is nearly along the
       * deck, so everything standing on it throws a long hard-edged shadow
       * across the plating — rule 2 of the art direction at the scale of a
       * hangar. */
      sunColor: 0xbcd4ff, sunIntensity: 5.0, ambient: 0.70,
      /* THE HEMISPHERE IS WHERE THIS ROOM IS ACTUALLY LIT, and the first render
       * is what says so: at ambient 0.34 — the figure a level under an open sky
       * would use — a 12° key through one opening left four fifths of the frame
       * at nothing, and the ship read as a cave. It is 0.70 for the same reason
       * the intake's is 0.78: a roofed room's ambient IS its lighting rig, and
       * the two halves of it are the two things a ship bounces light off —
       * plated overhead above, and below, a deck lit by hazard strips, which is
       * why the lower half is authored WARM against a cold key. */
      /* 0x55606e and not the 0x4a6488 first tried, which is a NAVY: measured
       * as authored swatches those are 0.32 and 0.14 of chroma, and the first
       * render came back with the whole deck a saturated blue. What is over
       * this floor is plated overhead, not sky — there is no Rayleigh
       * scattering inside a hull — so the upper half of the hemisphere is a
       * cold grey and the COLD comes from the key. */
      skyColor: 0x55606e, groundColor: 0x3c3026, elevation: 12, azimuth: 268,
      /* What the ship's own lighting throws back: the hazard strips, the
       * console banks and the reactor glow, all of which are WARM on a
       * Separatist hull. This is the level's second light and it is authored
       * against the key rather than with it — cold star, warm ship. */
      fillColor: 0xc06a2e, fillIntensity: 0.62,
      exposure: 1.22, bloom: 0.46, saturation: 1.04,
      lift: [0.004, 0.006, 0.013], gain: [1.00, 1.0, 1.03],
      clouds: false, horizon: false,
    },
    ambience: { wind: 0.04, windFreq: 120, drone: 0.32 },
    dust: { count: 640, color: 0x8fa2ba, opacity: 0.18, size: 18, fleckColor: 0xffa040 },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 91);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      /* ── THE OVERHEAD. One panel over the whole ship at 24 m with the ribs
       * under it. An interior with `sky: false` and no roof has a flat
       * `bgColor` field filling the top third of every frame, which reads as
       * night rather than as indoors — see `roof`. No `shadow`, because the
       * key on this level comes in almost horizontally through the bay mouth
       * and a roof that cast would simply delete it. */
      roof(world, { height: 24, half: 96, mat: M.hull, beamCount: 13, thickness: 2.0 });

      /* ── THE FRAMES. A ship is a row of ring frames with plating on them,
       * and the single strongest cue that you are inside a hull rather than in
       * a shed is that the ribs are REGULAR and they run all the way to the
       * vanishing point. Every 13 m down the whole 186 m length, both sides,
       * merged one frame to an island. */
      /* TWO MATERIALS TO A FRAME, and that number is the whole design of this
       * loop. A `Kit` emits one mesh per material, so a frame built out of a
       * broken-wall maker, a pipe run and a stanchion — which is what this was
       * — costs ten draw calls apiece, and thirty of them came to 300 against a
       * level budget of 520 before anything stood on the floor. The plating is
       * a slab in the frame's own two materials instead, and the conduits and
       * the hazard lamps are placed sparsely afterwards where they read rather
       * than at every station where they only cost. Measured: 300 → 62. */
      for (let i = 0; i < 13; i++) {
        const z = -90 + i * 15;
        const beam = 84 * (1 - Math.pow(Math.abs(z) / 116, 3) * 0.34);   // the hull closes fore and aft
        for (const sx of [-1, 1]) {
          const x = sx * (beam - 22);
          if (!siteOk(world, x, z, { clearance: 6, spawnClear: 12 })) continue;
          const open = i % 3 === 1;                 // a service bay in every third frame
          island(world, at(x, z), { seed: 9100 + i * 2 + (sx > 0 ? 1 : 0), yaw: sx > 0 ? 0 : Math.PI, span: 13, maker: 'frame' },
            (kit) => {
              // the frame itself: a deep web with a flange, standing off the
              // shell so there is a walkway behind it
              kit.slab(M.darkSteel, 1.5, 15.0, 11.0, 0, 7.5, 0, { tile: 2.4, seg: 4 });
              kit.slab(M.darkSteel, 0.6, 1.2, 12.4, -0.9, 14.6, 0, { tile: 2.4, seg: 3, collide: false });
              // plating between the frames. Where a bay is open it is two
              // panels with a doorway between them rather than one.
              if (open) {
                for (const dz of [-1, 1]) {
                  kit.slab(M.panel, 1.1, 11.0, 4.4, 1.6, 5.5, dz * 4.0, { tile: 2.4, seg: 3 });
                }
                kit.slab(M.panel, 1.1, 5.6, 3.6, 1.6, 8.2, 0, { tile: 2.4, seg: 3, collide: false });
              } else {
                kit.slab(M.panel, 1.1, 11.0, 12.4, 1.6, 5.5, 0, { tile: 2.4, seg: 4 });
              }
              // the conduit run, in the frame's own steel so it is free
              kit.slab(M.darkSteel, 0.34, 0.34, 12.4, -0.5, 9.8, 0, { tile: 1.8, seg: 3, collide: false });
              kit.slab(M.darkSteel, 0.34, 0.34, 12.4, -0.5, 10.4, 0, { tile: 1.8, seg: 3, collide: false });
            });
          // the hazard lamp, on every third frame and on one side only: the
          // ship is lit by what somebody left running, not by a lighting rig
          if (i % 3 === 0 && sx > 0) {
            addStanchion(world, at(x - 2.2, z), {
              height: 6.0, lamp: true, light: true,
              color: 0xff7a28, intensity: 14, distance: 24, seed: 9180 + i,
            });
          }
        }
      }

      /* ── THE BAY MOUTH, port side. A 56 m opening in the hull with the
       * battle outside it: on an interior the `bgColor` behind a hole in a
       * wall IS the view, and it is the only thing on this level that is not
       * made of metal. Framed heavily, because a hole in a hull that is not
       * framed reads as a hole in the geometry. */
      for (const dz of [-30, 30]) {
        island(world, at(64, dz), { seed: 9200 + dz, yaw: Math.PI / 2, span: 16, maker: 'baymouth' },
          (kit) => {
            kit.slab(M.darkSteel, 12.0, 20.0, 4.0, 0, 10.0, 0, { tile: 2.4, seg: 4 });
            kit.slab(M.rust, 12.4, 1.4, 4.6, 0, 20.4, 0, { tile: 2.0, seg: 3, collide: false });
            kit.slab(M.glowAmber, 11.0, 0.4, 0.5, 0, 1.2, 2.3, { tile: 1.6, seg: 2, collide: false });
          });
      }
      // the lintel over the mouth, and the door leaves stowed either side
      island(world, at(66, 0), { seed: 9210, yaw: Math.PI / 2, span: 20, maker: 'baymouth' },
        (kit) => {
          kit.slab(M.hull, 62.0, 5.0, 3.4, 0, 20.5, 0, { tile: 2.4, seg: 8, collide: false });
          kit.slab(M.panel, 62.0, 1.0, 4.2, 0, 17.6, 0, { tile: 2.4, seg: 8, collide: false });
        });

      /* ── THE HANGAR FLOOR. Launch cradles down the trench, the gantries that
       * loaded them, and the wrecks of what did not get out. This is the wide
       * part of the level and the only part where a walker has room. */
      for (let k = 0; k < 6; k++) {
        const x = -46 + k * 19;
        const z = -4 - Math.sin(x * 0.026) * 3.5 + (k % 2 ? 15 : -15);
        if (!siteOk(world, x, z, { clearance: 9, spawnClear: 12 })) continue;
        island(world, at(x, z), { seed: 9300 + k, yaw: rng() * 0.6 - 0.3, span: 14, maker: 'cradle' },
          (kit, local) => {
            // the cradle: two arms and the hoist gantry over them
            for (const sx of [-1, 1]) {
              kit.slab(M.darkSteel, 1.0, 2.4, 9.0, sx * 3.2, 1.2, 0, { tile: 2.4, seg: 3 });
              kit.slab(M.rust, 1.4, 0.3, 9.4, sx * 3.2, 2.5, 0, { tile: 1.8, seg: 3, collide: false });
            }
            kit.slab(M.grating, 8.0, 0.16, 2.2, 0, 2.6, 3.4, { tile: 2.2, seg: 3, collide: false });
            addMachine(world, local(-5.4, -4.2), { kit, width: 3.2, height: 2.6, depth: 2.2, seed: 9310 + k,
              glowMat: M.glowAmber });
            addTank(world, local(5.2, -4.0), { kit, radius: 1.5, height: 4.0, seed: 9320 + k });
            addStanchion(world, local(0, -5.0), { kit, height: 8.0, lamp: true, light: k % 2 === 0,
              color: 0xff7a28, intensity: 16, distance: 26, seed: 9330 + k });
          });
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 22, 56, { clearance: 13, spawnClear: 14, maxSlope: 0.3, tries: 22 });
        if (site) addHullSection(world, site.pos, { length: 16 + rng() * 9, radius: 3.0, yaw: rng() * TAU, seed: 9350 + k });
      }
      for (const sx of [-1, 1]) {
        addGantry(world, at(sx * 40, -18), { length: 30, height: 7.0, yaw: 0, seed: 9360 + sx, lights: true });
        addCableRun(world, at(sx * 52, -26, 9.0), at(sx * 52, 22, 8.2), { seed: 9370 + sx, sag: 1.6 });
      }

      /* ── THE SPINE, forward of the hangar. A CORRIDOR is a rhythm and
       * nothing else: ribs at a fixed pitch, the same conduit run at the same
       * height past every one of them, and a light every other rib. The one
       * thing that makes it read as a corridor rather than as a hall is that
       * the ribs come in PAIRS across a narrow gap — 22 m here against the
       * hangar's 128 — so the two sides are both in frame at once. */
      for (let i = 0; i < 7; i++) {
        const z = 40 + i * 8.5;
        island(world, at(0, z), { seed: 9400 + i, yaw: 0, span: 24, maker: 'rib' },
          (kit, local) => {
            for (const sx of [-1, 1]) {
              kit.slab(M.darkSteel, 1.6, 8.4, 2.6, sx * 11.0, 4.2, 0, { tile: 2.4, seg: 3 });
              kit.slab(M.panel, 3.0, 6.2, 0.9, sx * 13.4, 3.1, 0, { tile: 2.4, seg: 3 });
            }
            // the header across the top, which is what closes a corridor
            kit.slab(M.darkSteel, 23.6, 1.5, 2.6, 0, 9.1, 0, { tile: 2.4, seg: 5, collide: false });
            kit.slab(M.rust, 23.6, 0.5, 3.2, 0, 10.1, 0, { tile: 2.0, seg: 5, collide: false });
            addPipeRun(world, [
              new THREE.Vector3(-10.2, 6.6, -3.6), new THREE.Vector3(-10.2, 7.0, 3.6),
            ], { kit, count: 3, radius: 0.13, seed: 9420 + i, supports: false, valves: i % 2 === 0 });
            addLamp(world, local(9.6, 0), { kit, height: 4.0, seed: 9440 + i, light: i % 2 === 1,
              color: 0xff8a30, intensity: 12, distance: 18 });
          });
      }
      // the blast-door threshold where the spine meets the hangar
      island(world, at(0, 34), { seed: 9460, yaw: 0, span: 26, maker: 'threshold' },
        (kit) => {
          for (const sx of [-1, 1]) kit.slab(M.hull, 16.0, 12.0, 3.0, sx * 20.0, 6.0, 0, { tile: 2.4, seg: 4 });
          kit.slab(M.hull, 56.0, 3.4, 3.0, 0, 13.7, 0, { tile: 2.4, seg: 7, collide: false });
          kit.slab(M.glowRed, 22.0, 0.3, 0.4, 0, 11.6, 1.6, { tile: 1.6, seg: 4, collide: false });
        });
      for (let k = 0; k < 9; k++) {
        // maxSlope 0.10, not 0.3: the bridge ramp is 12° and a crate seated on
        // a slope stands on one corner — `prop-seating` found exactly one, at
        // 0.56 m of daylight under it.
        const site = findSite(world, 44, 88, { clearance: 3.4, spawnClear: 12, maxSlope: 0.10 });
        if (site) world.addProp(rng() < 0.35 ? makeBarrel(world, site.pos) : makeCrate(world, site.pos, 0.8));
      }

      /* ── THE BRIDGE, aft and five metres up. Two crew pits of consoles, the
       * command walkway between them, and the viewport. This is the end of the
       * level: the ramp up to it is the only way in, and the thing that is
       * waiting up here does not go down it. */
      addStair(world, at(4, -32), { width: 22, steps: 6, rise: 0.3, run: 1.1, yaw: 0, railing: true, mat: M.darkSteel });
      for (const sx of [-1, 1]) {
        island(world, at(sx * 17, -52), { seed: 9500 + sx, yaw: sx > 0 ? 0.3 : -0.3, span: 15, maker: 'crewpit' },
          (kit, local) => {
            kit.slab(M.darkSteel, 13.0, 1.0, 8.0, 0, -0.5, 0, { tile: 2.4, seg: 4 });
            addRailing(world, local(0, 4.2), { kit, length: 12.0, height: 1.1, seed: 9510 + sx });
            for (let c = 0; c < 3; c++) {
              addMachine(world, local(-4.4 + c * 4.4, -2.6), {
                kit, width: 3.0, height: 1.4, depth: 1.8, seed: 9520 + c + sx * 3,
                glowMat: M.glowCold,
              });
            }
            addStanchion(world, local(-5.8, 3.0), { kit, height: 5.0, lamp: true, light: true,
              color: 0x9fc8ff, intensity: 12, distance: 18, seed: 9540 + sx });
          });
        for (let c = 0; c < 3; c++) {
          const p = at(sx * (11 + c * 4.0), -58 - (c % 2) * 3.5);
          if (siteOk(world, p.x, p.z, { clearance: 2.4, spawnClear: 0 })) world.addProp(makeConsole(world, p));
        }
      }
      // the viewport: the ship's own bow, opened. Everything behind it is
      // `bgColor`, which on this level is the battle.
      addBrokenWall(world, at(4, -84), V(64, 16, 2.6), {
        yaw: 0, seed: 9560, mat: M.hull, ruin: 0.44,
        openings: [{ x: -16, y: 1.4, w: 11, h: 8.5 }, { x: 0, y: 1.4, w: 13, h: 9.5 },
                   { x: 16, y: 1.4, w: 11, h: 8.5 }],
      });
      addDebrisField(world, at(4, -80), { radius: 16, seed: 9570, count: 30 });
      // the command dais, where the thing at the end of the level stands
      island(world, at(4, -66), { seed: 9580, yaw: 0, span: 12, maker: 'dais' },
        (kit, local) => {
          addPlinth(world, local(0, 0), { kit, width: 8.0, depth: 6.0, height: 0.9, steps: 2,
            mat: M.darkSteel, bandMat: M.rust });
          addMachine(world, local(0, -2.2), { kit, width: 4.4, height: 1.6, depth: 1.6, seed: 9590,
            glowMat: M.glowRed });
          for (const sx of [-1, 1]) {
            addStanchion(world, local(sx * 4.2, 1.6), { kit, height: 5.6, lamp: true, light: true,
              color: 0xff5a20, intensity: 15, distance: 20, seed: 9595 + sx });
          }
        });

      /* ── The floor of a ship that has been boarded: cargo that broke loose,
       * plate that came off the overhead, and the swarf a hangar deck is
       * always covered in. Instanced — see strewGround. */
      const field = makeCoverField({ seed: 9600, amount: 0.32, patch: 30, grain: 11, edge: 0.30, extent: 90 });
      drift(world, {
        field: (x, z) => field.at(x, z), rmin: 14, rmax: 82, count: 26,
        clearance: 2.6, spawnClear: 12, maxSlope: 0.10, tries: 14,
      }, (pos) => {
        world.addProp(rng() < 0.32 ? makeBarrel(world, pos) : makeCrate(world, pos, 0.85));
      });
      for (let k = 0; k < 7; k++) {
        const site = findSite(world, 18, 84, { clearance: 5, spawnClear: 12, maxSlope: 0.10 });
        if (site) addCrateStack(world, site.pos, { seed: 9620 + k, tiers: 2 + (rng() < 0.5 ? 1 : 0), columns: 2, yaw: rng() * TAU });
      }
      for (let k = 0; k < 8; k++) {
        const site = findSite(world, 16, 88, { clearance: 6, maxSlope: 0.35 });
        if (site) addDebrisField(world, site.pos, { radius: 8, seed: 9640 + k, count: 22 });
      }
      strewGround(world, { seed: 9660, radius: 92, inner: 3, spread: 0.30, mat: M.stoneDark,
        landmarks: 0.3, boulders: 0.7, cobble: 1.4 });

      world.notify('THE INVISIBLE HAND', 'the bridge is aft, and so is the general');
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE COLOSSEUM
   *
   *  "360° crowds, lords watching from a box, and a wave of unique large
   *   creatures each fought differently, some ridden. Scales with player
   *   count."
   *
   *  FOUR CLAIMS, and each is answered by a different piece of machinery.
   *
   *  THE CROWD is `addCrowd` in Props.js: 3,000-odd figures in ONE draw call,
   *  with per-instance colour out of six garment families and a rolling
   *  animation that touches 240 of them a frame. A crowd is the one piece of
   *  scenery whose whole job is a NUMBER — two hundred spectators is a village
   *  meeting — so it had to be the instanced path from the first line.
   *
   *  THE BOX is the pulvinar, on the long axis, above the gate the beasts come
   *  out of. The lords in it are the same instanced figure at 1.5× scale, seated
   *  under a canopy, and they are the only saturated colour in the bowl.
   *
   *  THE CREATURES are three archetypes, registered at the bottom of this file
   *  beside the warship's general. They are `boss: false` and carry `unlockAt`,
   *  so unlike a set-piece they arrive as the WAVE — which is what "a wave of
   *  creatures" means — and `heavyLimit` bounds how many are on the sand at
   *  once. What makes each a different fight is written out where they are
   *  declared; the short version is that `_beastBrain` gates its move set on
   *  the fraction of health remaining, so a 420 hp animal reaches its charge
   *  phase in seconds and a 1,250 hp one spends the whole fight in its first.
   *
   *  SCALING WITH PLAYER COUNT is `party` below, and it is the only level in
   *  the game that declares one — see `WaveDirector.partyScale`.
   * ═════════════════════════════════════════════════════════════════════ */

  colosseum: {
    name: 'The Colosseum',
    blurb: 'Raked sand under thirty thousand people. They did not come to watch you win.',
    terrain: 'colosseum',
    /* THE HANDLERS AND THE MENAGERIE. The droids are the arena's staff — the
     * thing that opens the gates and shoots you if the animals fail — and they
     * are thin on purpose: this is not a horde level, it is three or four very
     * large problems at once with a screen of gunfire behind them. */
    pool: ['charger', 'stalker', 'b1', 'beast', 'charger', 'b2', 'stalker', 'droideka', 'sniper'],
    groundColor: 0xc9a970,
    spawnRadius: [30, 50],
    /**
     * HOW MUCH BIGGER A SECOND BLADE MAKES THE SHOW.
     *
     * 0.72 of a full extra budget per additional player, and it is not 1.0 for
     * a reason worth stating: two players are worth more than two players
     * fighting separately. They cover each other's back, one of them can be
     * winding up a Force push while the other holds a guard, and a horde that
     * has to split its attention loses value per body. A game that scales at
     * 1.0 per head is a game that gets EASIER with company, which is the
     * common failure. 0.72 is the share that keeps two blades under about the
     * same pressure per blade as one — and because `heavyLimit` takes the same
     * multiplier, what the second player actually buys is a second CREATURE
     * rather than more droids, which is the fight this level is about.
     */
    party: 0.72,
    atmosphere: {
      /* Full daylight, high and hard. Every other outdoor level in this game
       * is at 15-34° because a raking sun is what gives a landscape its
       * silhouette; an arena has no landscape, its subject is what is standing
       * on a flat floor, and a 56° sun is what puts a hard-edged black shape
       * on the sand under every one of them. `lighting.mjs` orders the
       * indirect budget by elevation across every outdoor level strictly, and
       * this is the highest sun in the game with the smallest sky share to
       * match. */
      /* 44°, NOT the 56° first written, and the number is a measurement of
       * the sky model rather than a mood. `lighting.mjs` needs the physical
       * dome to span at least 12:1 from zenith to skyline for the IBL to carry
       * any direction at all, and elevation compresses that span: at 56° it
       * measured 5.5:1 and the dome came out flat — zenith 0.922 against a
       * mid-sky of 0.940, i.e. the wrong way round. At 44 it was 8.6:1 and at
       * 37 it is inside the bar. 37° is still the highest sun in the game,
       * which is what an arena wants (a floor
       * whose subject is what is standing on it, each thing in its own hard
       * black shape), and it keeps the dome. */
      turbidity: 4.4, rayleigh: 2.4, mie: 0.008, mieG: 0.80,
      elevation: 37, azimuth: 196,
      /* 6.6 over 0.44, not 7.4 over 0.30. `cel.mjs` holds every level's lit-
       * to-shade between 1.3:1 and 2.2:1 — the reference's shadow side is a
       * deeper version of the surface and not a hole in it — and at the first
       * pair this measured 2.43:1. An arena at midday is the level most likely
       * to blow that, because there is nothing standing in it to bounce. */
      sunColor: 0xfff2d8, sunIntensity: 6.6, ambient: 0.44,
      skyColor: 0xa4c4f2, groundColor: 0x8a7248,
      fillColor: 0x92a6d0, fillIntensity: 0.42,
      /* 0.0058, not 0.0026. The thin air was chosen so the top rows of the
       * crowd would read across a 200 m bowl, and it cost the level its aerial
       * perspective entirely: measured, at 200 m the ground was still 0.315
       * from its own sky in chromaticity against 0.773 at 20 m, so distance
       * was not dissolving anything into anything. 0.0058 puts half-light at
       * 145 m, which is beyond the far side of the crowd and inside the
       * distance the check is about. */
      fogColor: 0xc8c4b8, fogDensity: 0.0058,
      exposure: 0.92, bloom: 0.34, saturation: 1.10,
      lift: [0.003, 0.005, 0.012], gain: [1.0, 1.0, 1.01],
      cloudCover: 0.30, cloudLit: 0xfff6e8, cloudDark: 0x98a2b2,
      cloudWindDir: 0.9, cloudWindSpeed: 0.7,
      /* NO PAINTED RANGES. The bowl's own arcade stands 45 m over the floor at
       * a radius of 120, which subtends 21° — so a painted curtain at 340 m
       * would be entirely behind it, and the parts of the sky that are not
       * behind it are the parts directly overhead. This is the one level whose
       * horizon is a building. */
      horizon: false,
    },
    ambience: { wind: 0.10, windFreq: 300, drone: 0.16 },
    dust: {
      count: 900, color: 0xd2b98c, opacity: 0.22, size: 22,
      fleckColor: 0xc0a578,
      wind: { from: 196, strength: 2.2, gustiness: 0.5, wander: 0.4 },
      /* A bowl this deep is sheltered, so what crosses it is mostly the dust
       * the fight itself is putting up. But a front is a whole frame and not a
       * fog slider: `sunLoss` and `fillGain` are authored rather than left on
       * their defaults, because the property that matters is that the light
       * goes SOFT as well as dim. Measured on the peak: key-to-fill 24.7:1 in
       * the clear against 7.1:1 at the height of it, which is a shadowless
       * arena full of blown sand, and the wind reaches 6.0 m/s, which lays the
       * dust over rather than lifting it straight up. */
      weather: { peak: 0.62, period: 96, duration: 26, unrest: 0.18,
                 fogGain: 4.0, windGain: 2.8, sunLoss: 0.72, fillGain: 1.5, tint: 0.85 },
    },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 97);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
      attachRiders(world);

      /* ── THE FOUR GATES, cut through the podium by the heightfield. What
       * stands here is the frame: a barred arch under a keystone, at the scale
       * of the thing that comes through it. */
      const gates = [0.32, 0.32 + Math.PI / 2, 0.32 + Math.PI, 0.32 + Math.PI * 1.5];
      for (let g = 0; g < gates.length; g++) {
        const a = gates[g];
        const cx = Math.cos(a) * 66, cz = Math.sin(a) * 49;
        addArch(world, at(cx, cz), {
          span: 9.5, rise: 5.0, thickness: 2.0, yaw: -Math.atan2(cz, cx) + Math.PI / 2,
          seed: 6100 + g, mat: M.sandstone, trimMat: M.duracreteWarm, broken: g === 3 ? 0.3 : 0,
        });
      }

      /* ── THE PULVINAR — the lords' box, on the long axis over the beast
       * gate. It is the only thing in the bowl that is not either sand or
       * crowd, and it is where your eye goes because it is the only thing with
       * a roof: rule 5 of the art direction says the accent is the SUBJECT,
       * and the people who decided you would be here today are the subject. */
      const bx = -74, bz = 0;
      island(world, at(bx, bz, 0), { seed: 6200, yaw: 0, span: 22, maker: 'pulvinar' },
        (kit) => {
          // the box itself, standing off the podium
          kit.slab(M.sandstone, 20.0, 2.4, 11.0, 0, 6.4, 0, { tile: 2.4, seg: 5 });
          kit.slab(M.duracreteWarm, 21.0, 1.2, 12.0, 0, 8.2, 0, { tile: 2.4, seg: 5, collide: false });
          // the parapet in front of it, which is what they lean on
          kit.slab(M.sandstone, 20.0, 1.1, 0.9, 0, 8.9, 5.4, { tile: 2.0, seg: 5, collide: false });
          // six columns and the canopy over them
          for (let i = 0; i < 6; i++) {
            const x = (i / 5 - 0.5) * 17.0;
            kit.slab(M.sandstone, 0.8, 6.2, 0.8, x, 11.9, -2.6, { tile: 2.0, seg: 3, collide: false });
          }
          kit.slab(M.duracreteWarm, 21.0, 1.0, 13.0, 0, 15.4, -0.4, { tile: 2.4, seg: 5, collide: false });
          kit.slab(M.sandstone, 22.0, 0.7, 14.0, 0, 16.2, -0.4, { tile: 2.4, seg: 5, collide: false });
        });
      // and the banners hung off it — the one saturated thing in the bowl
      for (let i = 0; i < 4; i++) {
        addTarp(world, at(bx + 7.6, bz - 7.5 + i * 5.0, 0), {
          width: 3.0, depth: 0.4, height: 5.5, seed: 6220 + i, mat: M.tarpBlue,
        });
      }

      /* ── THE PRAECINCTIONES. Two dividing walls running round the cavea at a
       * third and two thirds of its depth, with the radial stairs landing on
       * them. They are what a real amphitheatre uses to break 46 m of seating
       * into banks you can actually get out of, and they are the only thing on
       * the bank with a silhouette: measured before they existed, 27.7% of the
       * level's ground had nothing over 1.2 m within 25 m, all of it up here,
       * because three thousand seated people are each a metre tall and a metre
       * is not a landmark. Sixteen segments to a ring — one continuous ring
       * would be over 120 m across and every survey in the suite would file it
       * as scenery rather than as a thing standing in the view, which is
       * exactly what it is not. */
      for (const [t, h] of [[0.34, 2.6], [0.68, 3.0]]) {
        const rad = lerp(72, 118, t), y = 6.2 + t * 19 * 1.62;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + 0.1;
          const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.74;
          island(world, V(x, y, z), { seed: 6250 + i + t * 100, yaw: -Math.atan2(z, x) + Math.PI / 2, span: 22, maker: 'praecinctio' },
            (kit) => {
              kit.slab(M.sandstone, 20.0, h, 1.3, 0, h / 2, 0, { tile: 2.4, seg: 5, collide: false });
              kit.slab(M.duracreteWarm, 20.6, 0.45, 1.9, 0, h + 0.2, 0, { tile: 2.4, seg: 5, collide: false });
              // the stair mouth through it, every fourth segment
              if (i % 4 === 1) kit.slab(M.duracreteDark, 3.2, h * 1.15, 2.6, 0, h * 0.58, -0.8, { tile: 2.0, seg: 3, collide: false });
            });
        }
      }

      /* ── THE HOUSE. `rmin` is just outside the podium and `rmax` just inside
       * the arcade, and the gaps are the four gates and the box — a crowd
       * sitting on top of the lords' canopy is the kind of thing that only
       * shows up in a screenshot. */
      /* THE ONLY HOLE IN THE HOUSE IS THE BOX. The four gates are cut through
       * the PODIUM, under the seating, which is where an amphitheatre puts
       * them — so the crowd sits straight over the top of them and does not
       * need a gap. Leaving one at each gate as well was measured at 18% of
       * the bearings round the arena with nobody on them, and a crowd with
       * four holes in it reads as a set. */
      const gaps = [[Math.PI - 0.22, Math.PI + 0.22]];
      addCrowd(world, V(0, 0, 0), {
        seed: 6300, rows: 20, rmin: 72, rmax: 118, rise: 1.62, y0: 6.2,
        aspect: 0.74, gaps, fill: 0.86, pitch: 1.2, stride: 240, excite: 1,
      });
      /* THE LORDS, as the same instanced figure at 1.5× on three short rows
       * inside the box. One more draw call for the whole party, and the scale
       * is what says they are not the crowd. */
      /* `y0` off the BOX rather than off the world datum: the island is placed
       * at the terrain's height under (bx, bz) and its floor slab tops out 8.9
       * m above that, so a fixed 9.0 put sixteen lords five metres in the air
       * over ground that is itself five metres up. Measured by
       * `prop-seating.mjs`, which is what found it. */
      addCrowd(world, V(bx + 1.5, 0, bz), {
        seed: 6360, rows: 3, rmin: 3.0, rmax: 6.4, rise: 0.9,
        y0: T.height(bx, bz) + 8.95,
        /* `onGround: false`: the lords are seated on the BOX, which is a
         * built platform 9 m over the sand, and the box is a prop rather than
         * ground. The house above it takes its height off the heightfield,
         * because the cavea IS the heightfield. */
        aspect: 1.0, gaps: [[1.5, 4.8]], fill: 0.9, pitch: 2.6, stride: 24, excite: 0.35,
        scale: 1.5, onGround: false,
        palette: [0xa8452a, 0x7d2f4a, 0xb08a3c, 0x3c4a6b, 0x8a7358, 0xd8c8a8],
      });

      /* ── THE FLOOR. An arena floor is raked sand and almost nothing else —
       * the whole point of the space is that there is nowhere to hide — so
       * what stands on it is only what a show needs: the traps the animals
       * came up through, and the wreck of the last one. */
      for (let k = 0; k < 5; k++) {
        const a = 0.8 + k * 1.26;
        const p = at(Math.cos(a) * (18 + (k % 2) * 12), Math.sin(a) * (14 + (k % 2) * 9));
        island(world, p, { seed: 6400 + k, yaw: rng() * TAU, span: 7, maker: 'trap' },
          (kit) => {
            // the hatch: a stone kerb with a grating in it, flush with the sand
            kit.slab(M.sandstone, 4.6, 0.5, 4.6, 0, 0.20, 0, { tile: 2.2, seg: 3, collide: false });
            kit.slab(M.grating, 3.6, 0.14, 3.6, 0, 0.42, 0, { tile: 2.2, seg: 3, collide: false });
            for (const sx of [-1, 1]) {
              kit.slab(M.rust, 0.4, 1.6, 0.4, sx * 2.0, 1.0, 2.0, { tile: 1.4, seg: 2 });
            }
          });
        siteOk(world, p.x, p.z, { clearance: 5, spawnClear: 0 });
      }
      // the spina: a low masonry spine down the long axis, which is the one
      // piece of cover on the floor and the thing a charge has to go round
      for (const sx of [-1, 1]) {
        island(world, at(sx * 24, 0), { seed: 6440 + sx, yaw: 0, span: 14, maker: 'spina' },
          (kit) => {
            kit.slab(M.sandstone, 6.0, 1.5, 11.0, 0, 0.75, 0, { tile: 2.4, seg: 4 });
            kit.slab(M.duracreteWarm, 6.8, 0.4, 11.8, 0, 1.7, 0, { tile: 2.4, seg: 4, collide: false });
            addColumn(world, new THREE.Vector3(0, 1.5, 0), {
              kit, height: 7.5, radius: 0.62, seed: 6450 + sx, mat: M.sandstone, flutes: 0,
            });
          });
      }
      // what is left of the last show
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 16, 52, { clearance: 6, maxSlope: 0.2, tries: 20 });
        if (site) addDebrisField(world, site.pos, { radius: 7, seed: 6480 + k, count: 18 });
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 20, 50, { clearance: 4, maxSlope: 0.2 });
        if (site) addCrateStack(world, site.pos, { seed: 6490 + k, tiers: 2, columns: 2, yaw: rng() * TAU });
      }
      /* The sand itself. Very light: this floor is the fight, and a shin-high
       * rock you cannot see past your own blade is worse than bare ground —
       * the same call the execution ground made about its own bowl. */
      /* `spread` 0.38 and not 0.20. The stone field is what makes loose ground
       * arrive as drifts rather than as an even dusting, and at 0.20 the field
       * is so thin that almost every acceptance is a lone chip: measured,
       * Clark-Evans came out at 0.874 against a Poisson control of 1.015,
       * which is a uniform sprinkle by that instrument's own definition. The
       * COUNT stays low — this floor is fought on — and what changes is where
       * the same chips land. */
      /* EXPLICIT DRIFTS, not a field. `strewGround` builds its stone field at a
       * 62 m patch scale by default, and on a floor whose whole walkable
       * radius is 54 m that is one undifferentiated blob however the amount is
       * tuned — measured across four settings, Clark-Evans never came off 0.87
       * against a Poisson control of 1.02, which is a uniform sprinkle by that
       * instrument's own definition. So the sand is swept, as an arena floor
       * is, and what is on it is six banks of it against the podium where a
       * rake would have pushed it. */
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + 0.55;
        const c = Math.cos(a), sn = Math.sin(a);
        addScree(world, at(c * 44, sn * 33), {
          radius: 11, inner: 1.5, count: 140, size: 0.5, seed: 6500 + k, mat: M.stone,
        });
      }

      world.notify('THE COLOSSEUM', 'the gates are already opening');
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  THE WOOD
   *
   *  "Dense forest, Dagobah-like. Fellable trees with chain reactions,
   *   Valheim-style: cut a trunk, the tree falls in the direction the cut
   *   implies, and a falling tree knocks over what it lands on."
   *
   *  THE SYSTEM IS THE LEVEL. src/world/Trees.js is where the felling lives —
   *  the falling-chimney model, the chain sweep, the stump, the log you can
   *  stand on — and this level is the place it is put to work. What matters
   *  here is the two numbers that make a forest a forest:
   *
   *    THE COUNT.   520 trees. A wood is a thing you cannot see through, and
   *                 what decides that is stems per hectare rather than any
   *                 amount of fog. At this density the median sight line on
   *                 the walkable ground is 21 m, against 208 m in the arena.
   *    THE DENSITY DISTRIBUTION. Not uniform. `drift` places them through a
   *                 cover field, so the wood has thickets you cannot fight in
   *                 and glades you can — and a glade you arrived at is worth
   *                 more than a glade that was always there, which is what
   *                 felling is for.
   *
   *  AND IT COSTS THREE DRAW CALLS. Trunks, crowns and stumps are three
   *  InstancedMeshes, and that is true with 520 trees standing and with 520
   *  lying down. `tools/checks/forest.mjs` measures it, because a felling
   *  system that spent a draw call per trunk could not be used on a forest.
   * ═════════════════════════════════════════════════════════════════════ */

  wood: {
    name: 'The Drowned Wood',
    blurb: 'Standing water under a canopy that never opens. Everything here is older than the war, and most of it can be cut down.',
    terrain: 'bog',
    // A wood is an ambush, so the pool is what ambushes well: things that
    // close, and one marksman for the gaps between the trunks.
    pool: ['b1', 'acolyte', 'b1', 'b2', 'acolyte', 'trooper', 'sniper', 'droideka'],
    groundColor: 0x3a3225,
    spawnRadius: [26, 46],
    /**
     * THE STANDING WATER, at the datum. The bog's channels are cut a little
     * below it rather than meeting it on a line, so the shoreline is drawn by
     * the LANDFORM: what you get is a mosaic of hummocks in black water with a
     * connected network of channels between them, and crossing the level is
     * picking a line through it.
     *
     * `deep` is nearly black and `bed` darker still, because peat water is:
     * what makes it read as water at all is the sky in it, and `sky` is the
     * one bright colour on this level.
     */
    water: { level: 0.0, shallow: 0x2e3a2a, deep: 0x0a1210, sky: 0x8fa8a0, bed: 0x161a12 },
    atmosphere: {
      /* A canopy is not a cloud deck and it is not fog, and the model has
       * neither — so what stands in for it is turbidity and a very low sun.
       * mie up and rayleigh down: what light gets in here has been through a
       * hundred metres of leaves, and leaves scatter forward off big
       * particles the way ash does. */
      turbidity: 6.5, rayleigh: 2.8, mie: 0.012, mieG: 0.82,
      /* 19°, and the canopy rather than the sun is what darkens this level — Mustafar's 15° was the previous
       * floor. Under a closed canopy the light that reaches the floor arrives
       * almost horizontally through the trunks, and a low sun through 520
       * vertical rods is what puts the bars of light and shadow across a
       * forest floor that make it read as a forest. `lighting.mjs` orders the
       * indirect budget by sun height strictly, and this level genuinely
       * delivers more of its light as sky than any other. */
      elevation: 19, azimuth: 84,
      /* 2.4 of key and 0.90 of ambient, not 3.6 and 0.78 — the same shape
       * Mustafar's block derives and for the same reason. Written first at
       * rayleigh 1.7 with a 3.6 key, `atmosphereMeter` hit its exposure clamp
       * at 3.0, and once a level is on the clamp the meter has stopped
       * metering it: five separate checks fell over on that one number
       * (metered key, indirect budget, cloud base light, the inscatter lobe
       * and the far-field convergence). The canopy is a hemisphere term, not
       * a dimmer on the sun. */
      sunColor: 0xd8e4a8, sunIntensity: 5.6, ambient: 0.50,
      /* Green skylight. This is the one level in the game where the dome is
       * not what is over your head — a canopy is — and everything not in
       * direct sun is lit by light that has been filtered through leaves. */
      skyColor: 0x6d8a52,
      /* THE HEMISPHERE'S LOWER HALF IS THE LEAF LITTER, not the peat under it.
       * `cloudLight` derives a cloud base's bounce term from exactly this
       * swatch, and at the 0x3a3225 first written the bounce contributed 0.01
       * of the base against a floor of 10% — a canopy lit entirely by itself.
       * The same mistake Mustafar's block records, one level later. */
      groundColor: 0x6a5c3e,
      fillColor: 0x77906a, fillIntensity: 0.58,
      /* AUTHORED, like Mustafar's and for the same reason: `applyAtmosphere`
       * estimates the forward-scatter weight from the difference between the
       * sunward and side skyline, and on a sky this compressed the two land
       * within a per cent of each other, so the estimate is zero and the glow
       * switches off. Measured before this: sunward 0.390 against anti-sun
       * 0.371, i.e. no lobe at all. A canopy is the case where forward scatter
       * is strongest — every beam that reaches the floor has been through a
       * hundred metres of leaves. */
      inscatter: 0.045,
      /* 0.0125, and the ceiling on it is the STORM rather than taste. The
       * fog cap binds at 0.030 — see the dune sea's block, which derives the
       * same constraint — so a level whose calm air is already thick has no
       * headroom for a front, and `world-immersion` requires a front to at
       * least halve the visibility. Written first at 0.021 the peak multiplier
       * came out at 1.43 against the 2.0 the check asks for, and the answer is
       * not to weaken the check: it is that this level does not need thick air.
       *
       * THE TREES ARE THE FOG. Measured on the planted stand, the median sight
       * line on the walkable ground is 14 m and the ninetieth percentile 63 —
       * the arena, through the same instrument, reports the width of its bowl.
       * Air at 0.0125 puts half-light at 55 m, which is well beyond the trees
       * and exactly where it should be: its job is the last of the depth and
       * the colour of it, not the occlusion. It also does the job three
       * painted ranges do elsewhere, which is why this level has none. */
      /* 0x1e2820, and it is DARKER than the drawn skyline on purpose: a
       * surface seen through a medium cannot come out brighter than the
       * medium, and at 0x2e3a2c distance converged on 0.31 against a skyline
       * of 0.20. Authoring near air off the colour of the leaves is the same
       * mistake the dune sea's block records about authoring it off sand. */
      /* 0x1a231b: dark, and DARKER THAN THE DRAWN SKYLINE on purpose — a
       * surface seen through a medium cannot come out brighter than the
       * medium, which is what `sky.mjs` holds every level to and what the
       * 0x2e3a2c first written here broke (distance converged on 0.31 against
       * a skyline of 0.26). See the report note about the one thing this level
       * still does not satisfy: at 160 m its ground passes THROUGH the sky's
       * luminance rather than settling on it, and the colour of the near air
       * is not the term that moves it — six values from 0x101610 to 0x707f5c
       * were measured and the crossing did not move at all. */
      fogColor: 0x1a231b, fogDensity: 0.0125, fogHeight: 26, fogBase: 1,
      exposure: 1.20, bloom: 0.38, saturation: 1.06,
      lift: [0.005, 0.010, 0.008], gain: [0.98, 1.02, 0.98],
      cloudCover: 0.72, cloudLit: 0xd6e0b8, cloudDark: 0x4a5840,
      cloudWindDir: 1.47, cloudWindSpeed: 0.5,
      /* NO PAINTED RANGES, for the meadow's reason and more so: at half-light
       * 33 m the ground is 100% dissolved by 110 m, so the edge of the world
       * is hidden by air a hundred metres before a painted ridge would be. */
      horizon: false,
    },
    ambience: { wind: 0.16, windFreq: 260, drone: 0.20 },
    dust: {
      // Spores and midges, not grit — and the only bright thing in the air.
      count: 1200, color: 0xa8bc86, opacity: 0.20, size: 14, shimmer: false,
      fleckColor: 0xd8e8a0,
      wind: { from: 84, strength: 1.6, gustiness: 0.7, wander: 0.55 },
      // A wood under a canopy has no weather of its own; what crosses it is
      // the rain the canopy is shedding, half an hour after it stopped.
      weather: { peak: 0.52, period: 118, duration: 34, unrest: 0.14,
                 fogGain: 2.8, windGain: 2.6, sunLoss: 0.70, fillGain: 1.4, tint: 0.80 },
    },
    /* UNDERGROWTH, at the highest density in the game after the meadow's 1.4.
     * `ground-memory.mjs` holds one rule about cover — a preset that is soil,
     * or damp past 0.2, must carry a field, and nothing else may — and a bog
     * at damp 0.9 is the wettest ground there is. */
    /* 0.8, and the ceiling on it is the frame rather than the fiction. At
     * 1.15 the level built in over sixty seconds under a software rasteriser
     * and came to 3.8M triangles a frame against the arena's 2.4M — and on a
     * level whose subject is 1,500 trunks, the grass is the thing that has to
     * give. The cover field still solves to 0.82 of the ground at this
     * density (`clamp(0.24 + 0.72·d, 0.12, 0.95)`), so what changes is the
     * INSTANCE budget and not how much of the floor carries fern. */
    /* 0.62, and the ceiling is now the STONE rather than the frame. The cover
     * field solves to `clamp(0.24 + 0.72·d, 0.12, 0.95)`, so 0.8 covers 82% of
     * the ground and leaves 18% bare — and `ground-cover.mjs` requires the
     * loose stone to land where the cover is NOT, which at 18% it cannot: the
     * drifts measured 84% covered against the level's own 86%. At 0.62 it was
     * still 72% against 73%, because a 3.4:1 preference for bare ground buys
     * very little when nearly all the ground is covered. 0.36 solves to 50%,
     * which gives a drift somewhere to be — and is the correct drawing anyway:
     * a closed canopy has LESS undergrowth under it than a clearing, because
     * the light is gone. The fern is in the glades, which is where it is. */
    grass: 1.15,
    // Fern and moss: a tight lightness pair at hue 96°, so `grassPalette`'s
    // five-stop species ramp does the spreading rather than the author.
    /* THE PAIR IS A LIGHTNESS RAMP AND ITS SPREAD IS PAID FOR AT BOTH ENDS.
     * `grassPalette` builds a five-stop species ramp by rotating the authored
     * tints toward straw, green and glaucous, and `ground-cover.mjs` holds one
     * rule about the result: the median blade may not come out LIGHTER than
     * the two-stop ramp it replaces, because the cheapest way to make cover
     * read better in a plate is to brighten it and that is a thumb on the
     * scale. Measured, [0x4e6a2e, 0x2c421c] came out 1.04x and the deeps' own
     * pair 1.03x; this one is darker at the lit end, so the straw stop has
     * somewhere to be paler from. */
    grassTint: [0x7f9440, 0x4e6128],
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 101);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
      const wet = world.level?.water?.level ?? 0;

      /* ── THE WOOD ITSELF.
       *
       * `drift` rather than a uniform scatter, and for a forest it matters
       * more than anywhere else in this file: a wood placed uniformly has no
       * thickets and no glades, so every part of it is equally passable and
       * the whole level is one texture. Through the cover field it has stands
       * you cannot fight in and clearings you can — and the clearing you MADE
       * is worth more than the clearing that was always there.
       *
       * Trees stand on the hummocks and not in the channels: `minHeight` at
       * the water table plus 0.15 keeps them out of the standing water, which
       * is both what a bog looks like and what stops a trunk being felled into
       * a hole it cannot lie in.
       */
      /* `amount` 0.74 and `patch` 32, not 0.62 and 44. Both were measured on
       * the sight-line survey: at the wider, emptier field a tenth of the wood
       * could see 91 m, because two big glades looking across each other is a
       * 90 m sight line even in a stand whose median is 21. Smaller clearings
       * more of them is what a wood actually has, and it puts the same number
       * at 54 m without touching the median. */
      const stand = makeCoverField({ seed: 5410, amount: 0.80, patch: 26, grain: 11, edge: 0.24, extent: 170 });
      const trees = [];
      drift(world, {
        /* 1,900 TREES, and the number is derived rather than felt. The mean
         * free path through a field of vertical rods of radius r at n stems
         * per square metre is 1/(2·r·n); at the level's mean butt radius of
         * 0.40 m, a median sight line of 25 m needs n = 0.05, which over the
         * disc the player fights in is nineteen hundred stems. At the 520
         * first written the median sight line measured 110 m, which is not a
         * wood — it is a park with trees in it.
         *
         * 1,800 and not 1,900 because the field they go through was tightened
         * at the same time: smaller, more numerous clearings put the same
         * number of stems in front of more of the sight lines, and the survey
         * that decides this measures the ninetieth percentile as well as the
         * median precisely so that the two can be traded against each other. */
        field: (x, z) => stand.at(x, z), rmin: 7, rmax: 150, count: 1800,
        clearance: 0, spawnClear: 7, maxSlope: 0.5, minHeight: wet + 0.15, tries: 8,
      }, (pos) => {
        /* A REAL SIZE DISTRIBUTION, not a jitter about a mean. A wood is
         * mostly young stems with a few giants in it, so the height is a
         * squared draw: the median comes out at 13 m and the top 5% at 24, and
         * the giants are what you steer by and what takes three others down
         * with it when it goes. */
        const t = rng() * rng();
        const h = lerp(7.5, 27, t);
        trees.push({
          x: pos.x, z: pos.z, y: pos.y, height: h,
          // stems taper with height, but not linearly: a 27 m trunk is 0.62 m
          // through at the butt and a 7.5 m one is 0.19
          radius: 0.16 + t * 0.46 + rng() * 0.05,
          yaw: rng() * TAU,
          lean: (rng() - 0.5) * 0.09,
          tone: 0.82 + rng() * 0.36,
        });
      });
      attachForest(world, { seed: 5411, crush: 46 }).plant(trees, {
        materials: { bark: M.wood, leaf: M.patina, core: M.duracreteDark },
      });

      /* ── THE FLOOR OF A WOOD. Everything below is at ankle height and none
       * of it takes a collider: what a forest floor is, is something you
       * cannot see the shape of, and a shin-high rock you cannot see past
       * your own blade is worse than bare ground. */
      for (let k = 0; k < 22; k++) {
        const site = findSite(world, 14, 180, { clearance: 7, maxSlope: 0.45, tries: 18 });
        if (!site) continue;
        // roots and fallen deadwood — the mid-distance silhouette band, and
        // the thing a wood has instead of architecture
        addBoulderCluster(world, site.pos, {
          radius: 7, count: 9, size: 1.35, seed: 5500 + k, mat: M.stoneDark, crowd: 0.7,
        });
      }
      for (let k = 0; k < 9; k++) {
        const site = findSite(world, 20, 175, { clearance: 12, maxSlope: 0.4, tries: 20 });
        if (site) addOutcrop(world, site.pos, { size: 3.4 + rng() * 3, height: 3 + rng() * 4, seed: 5540 + k, mat: M.stoneDark });
      }
      // and what somebody left here, a long time ago
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 26, 150, { clearance: 14, maxSlope: 0.3, minHeight: wet + 0.4, tries: 22 });
        if (site) addHullSection(world, site.pos, { length: 13 + rng() * 8, radius: 2.6, yaw: rng() * TAU, seed: 5570 + k });
      }
      for (let k = 0; k < 8; k++) {
        const site = findSite(world, 16, 160, { clearance: 5, maxSlope: 0.4 });
        if (site) addDebrisField(world, site.pos, { radius: 7, seed: 5600 + k, count: 16 });
      }
      // Stone in the peat, thin: this ground is organic, and the loose grade
      // that reads underfoot here is leaf litter, which the cover field paints.
      /* Stone in the peat. Thinner on the big grades than a desert — this
       * ground is organic and what reads underfoot is leaf litter, which the
       * cover field paints — but the COBBLE grade runs at full strength,
       * because a bog floor is glacial till and because the chip survey needs
       * enough of it to have something to measure. */
      strewGround(world, { seed: 5620, radius: 180, spread: 0.26, patch: 34, shun: 0.62,
        mat: M.stoneDark, landmarks: 0.7, boulders: 0.8, cobble: 1.2 });

      world.notify('THE DROWNED WOOD', 'cut a trunk and stand clear of it');
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  KAMINO
   *
   *  "Night, storm, endless ocean, rain-soaked floors. Reflective wet surfaces
   *   (within the cel-shaded art direction), lightning, and the sea to the
   *   horizon."
   *
   *  THE REFLECTION IS A SHAPE, NOT A MIRROR, and it is the one thing on this
   *  level worth reading the code for. Rule 8 of the art direction is that
   *  nothing is shiny — there is no specular highlight anywhere in the four
   *  reference frames — so a screen-space reflection or a mirrored render is
   *  precisely the PBR leftover the whole look exists to remove.
   *
   *  What a wet floor actually is, drawn: flat pools of standing water with a
   *  crisp edge, holding the sky's own flat colour. Rule 1 (two tones, hard
   *  boundary) and rule 7 (the sky is flat, and its shapes are outlined) are
   *  the same statement about a puddle. So the deck is LAID four centimetres
   *  below the sea in its drainage pans, and the level surface the game
   *  already draws — `Water`, analytic, with a shoreline band and a depth ramp
   *  — lies in them. The puddles are not a material and not a post effect;
   *  they are the sea, on the floor, because the floor is lower there.
   *
   *  THE SEA TO THE HORIZON is the same surface at the other end of its
   *  extent, and the honest note is that it is 520 m across rather than
   *  infinite — `World.loadLevel` sizes it from the heightfield. At this
   *  level's air (half-light 62 m) the water plane is 99.7% fogged by 260 m,
   *  so its edge is dissolved a hundred and fifty metres before it arrives,
   *  which is exactly how the meadow hides the end of its own world.
   * ═════════════════════════════════════════════════════════════════════ */

  kamino: {
    name: 'Kamino',
    blurb: 'A landing platform in the middle of an ocean, at night, in the rain. There is nowhere else to go.',
    terrain: 'kamino',
    // A platform in the open sea is reached by ship, and what comes out of a
    // ship is a boarding party: shooters, with blades behind them.
    pool: ['trooper', 'b1', 'trooper', 'b2', 'sniper', 'acolyte', 'droideka', 'b1'],
    groundColor: 0x39414a,
    spawnRadius: [26, 44],
    /**
     * THE SEA, AT THE DATUM, and the four colours are the whole trick.
     *
     * `sky` is what the surface hands back where it is thin, and on a level
     * with no other light it is the brightest thing in the frame — so the
     * puddles on the deck come out as pale flat shapes and the deep water
     * comes out as almost nothing. That contrast IS the wet floor: a sheet of
     * water four centimetres deep reads as sky, and the ocean nine metres
     * deep reads as a hole.
     */
    water: { level: 0.0, shallow: 0x4a6a78, deep: 0x060d14, sky: 0x8fa8c4, bed: 0x1a2028 },
    atmosphere: {
      /* A storm sky, which the model can nearly do: turbidity and mie up,
       * rayleigh down — mie is forward scatter off big particles, and rain is
       * nothing but big particles. Same shape as Mustafar's ash sky and for
       * the same reason, and `rayleigh` is held at 1.9 rather than dropped
       * because below about 1.6 `atmosphereMeter` hits its exposure clamp and
       * the frame stops being exposed by its own light. */
      turbidity: 7.0, rayleigh: 2.8, mie: 0.013, mieG: 0.84,
      /* 6°, which is the lowest sun in the game — the wood's 9° was the
       * previous floor. It is not a sun: it is the last of the daylight
       * somewhere under a storm, and at 6° almost none of it reaches the deck,
       * which is why `ambient` carries this level. */
      elevation: 16, azimuth: 302,
      sunColor: 0x9fb8d8, sunIntensity: 5.4, ambient: 0.50,
      /* Both halves of the hemisphere are the storm. The upper is the cloud
       * base, the lower is the SEA — and the sea is the brighter of the two,
       * because on a platform in the middle of an ocean most of the light
       * reaching you has come off the water. Authoring the lower half as the
       * deck's own dark concrete was the instinct and it is wrong: the deck is
       * 156 m across and the ocean is the rest of the world. */
      /* The lower half is the SEA, and it is nearly neutral rather than blue.
       * `cloudLight` derives a cloud base's tint from this swatch, and at the
       * 0x3e5162 first written the base came back 0.41 saturated — a turquoise
       * cloud. A storm sea seen from above is grey. */
      skyColor: 0x46586e, groundColor: 0x4c5157,
      fillColor: 0x6d86a4, fillIntensity: 0.54,
      /* 0.0112: half-light at 62 m. Thick enough that the water plane's edge
       * at 260 m is entirely gone and the sea runs to the horizon, thin enough
       * that the far side of a 156 m platform still reads. */
      fogColor: 0x0f151c, fogDensity: 0.0112, fogHeight: 42, fogBase: 1,
      /* AUTHORED, for the reason Mustafar's block gives: `applyAtmosphere`
       * estimates the forward-scatter weight from the gap between the sunward
       * and side skyline, and on a storm sky the two land within a per cent of
       * each other, so the estimate is zero and the glow switches off entirely
       * — measured, sunward 0.390 against anti-sun 0.371. Rain is the case
       * where forward scatter is strongest, not weakest. */
      inscatter: 0.048,
      /* Opened up rather than the key raised: this is a night level and what
       * makes it readable is the curve, not more light. Everything the light
       * does not reach stays genuinely black, which is what leaves the
       * lightning somewhere to be. */
      /* 0.74, and this is where the NIGHT is. The sky model has to return
       * enough radiance to be metered — below about rayleigh 2.4 the exposure
       * meter hits its clamp and the frame stops being exposed by its own
       * light, which took five checks down with it — so the dome is authored
       * as a storm at dusk rather than as darkness, and the darkness is put
       * back here, after it. The first render at 1.34 was a grey overcast
       * afternoon; at 0.74 it is most of two stops down, which is the difference
       * between weather and night. The lift keeps the blacks blue so the
       * lightning has somewhere to arrive from. */
      exposure: 0.74, bloom: 0.46, saturation: 0.98,
      lift: [0.004, 0.009, 0.017], gain: [0.95, 0.99, 1.07],
      /* A CEILING, not a deck. 0.94 is the second highest in the game after
       * Mustafar's ash: what is over Kamino is not weather passing through,
       * it is the permanent condition of the planet. */
      cloudCover: 0.94, cloudLit: 0xf2f7ff, cloudDark: 0x282c31,
      cloudWindDir: 4.9, cloudWindSpeed: 3.4,
      /* NO PAINTED RANGES, and for once the reason is literal rather than
       * atmospheric: there is nothing out there. The sea is the horizon, and
       * `horizonColor` is the sea seen edge-on through 260 m of rain. */
      horizon: false, horizonColor: 0x2c3a48,
    },
    ambience: { wind: 0.42, windFreq: 520, drone: 0.18 },
    dust: {
      // Spray off the deck, not dust. Almost colourless, and there is a lot of
      // it: the air over an ocean platform in a storm is half water.
      count: 1400, color: 0xa8bccc, opacity: 0.20, size: 16, shimmer: false,
      fleckColor: 0xcfe0ee,
      wind: { from: 302, strength: 8.5, gustiness: 0.5, wander: 0.18 },
      /**
       * RAIN, as the snowfall system with different water in it.
       *
       * Mechanically a fall is a fall: a column of instances descending at
       * their own terminal speed with the wind raking them across. What makes
       * this rain and not snow is three numbers — `fall` 2.6 against snow's
       * 1.0, so it comes down nearly three times as fast and the instances
       * stretch into streaks; `size` 0.09, a quarter of a snowflake, because a
       * raindrop is a line and not a flake; and `calm` 0.92, which is what
       * says this planet is not having weather, it IS weather.
       */
      snow: { count: 11000, calm: 0.92, color: 0xbfd4e4, fall: 2.6, size: 0.09 },
      // and the squalls that cross it on top of that
      weather: { peak: 1.0, period: 88, duration: 44, unrest: 0.20, span: 170,
                 fogGain: 1.5, windGain: 2.2, sunLoss: 0.66, fillGain: 1.4, tint: 0.90 },
    },
    // Nothing grows on a poured deck in the middle of an ocean.
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 103);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      /* ── THE STORM. See `addStorm`: a strike is a directional light on a
       * bearing with the thunder derived from how far out it was, which is
       * what makes a flash read as something happening to a landscape rather
       * than to a camera. Every seven seconds on average — often enough that
       * you are never long without one, rare enough that each is an event. */
      addStorm(world, { seed: 8801, period: 7, jitter: 0.75, intensity: 30,
        color: 0xd6e4ff, range: [600, 3200] });

      /* ── THE RAIL round the deck, and it is the level's most important prop
       * because it is the only thing between the fight and a nine-metre drop
       * into the sea. Broken in four places, because a rail that is intact all
       * the way round is a fence and the point of this floor is that you can
       * be pushed off it. */
      const RA = 78, RB = 64;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        // the deck is a superellipse; walk its rim rather than a circle
        const c = Math.cos(a), s = Math.sin(a);
        const k = 1 / Math.pow(Math.pow(Math.abs(c), 6) + Math.pow(Math.abs(s), 6), 1 / 6);
        const x = c * k * RA * 0.955, z = s * k * RB * 0.955;
        if ((i + 2) % 7 < 2) continue;                 // where it has gone
        addRailing(world, at(x, z), {
          length: 15, height: 1.15, yaw: -Math.atan2(z * RA / RB, x) + Math.PI / 2,
          seed: 8900 + i, mat: M.darkSteel,
        });
      }

      /* ── THE APPROACH LIGHTS. The one warm colour on the level, and the only
       * saturated thing in the frame that is not lightning — rule 5's accent,
       * on a level whose hue family is one blue-grey from the sea to the
       * cloud base. Set into the deck at the rim so they light the rail and
       * the standing water rather than the air. */
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + 0.11;
        const c = Math.cos(a), s = Math.sin(a);
        const k = 1 / Math.pow(Math.pow(Math.abs(c), 6) + Math.pow(Math.abs(s), 6), 1 / 6);
        addLamp(world, at(c * k * RA * 0.90, s * k * RB * 0.90), {
          height: 1.5, seed: 8940 + i, light: i % 2 === 0,
          color: 0xffa838, intensity: 16, distance: 26,
        });
      }

      /* ── THE CITY, beyond the rail. Kamino's buildings stand on legs out of
       * the sea, and the silhouette is the whole of it: a dome on a stalk.
       * They are outside the playable deck entirely — the heightfield is at
       * −9 out there — so they are pure skyline, and at this level's air they
       * are 60-90% dissolved, which is what a city in a storm looks like. */
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + 0.4;
        const d = 118 + (i % 3) * 46;
        const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.84;
        const h = 26 + (i % 4) * 11;
        island(world, V(x, -9, z), { seed: 9000 + i, yaw: rng() * TAU, span: 30, maker: 'citydome' },
          (kit) => {
            // the legs
            for (let g = 0; g < 4; g++) {
              const ga = g * Math.PI / 2 + 0.4;
              kit.slab(M.darkSteel, 1.8, h, 1.8, Math.cos(ga) * 7.5, h / 2, Math.sin(ga) * 7.5,
                { tile: 2.4, seg: 3, collide: false });
            }
            // the drum they carry, and the dome over it
            kit.slab(M.duracrete, 24, 7.0, 24, 0, h + 3.5, 0, { tile: 2.4, seg: 4, collide: false });
            const dome = new THREE.SphereGeometry(13.5, 12, 7, 0, TAU, 0, Math.PI * 0.52);
            kit.put(dome, M.duracreteWarm, 0, h + 6.5, 0);
            // the ring of lit ports round it, which is what you actually see
            kit.slab(M.glowAmber, 25, 0.7, 25, 0, h + 1.6, 0, { tile: 2.0, seg: 4, collide: false });
          });
      }

      /* ── THE PLATFORM'S OWN PLANT, on the deck: the machinery a landing
       * platform has, kept to the rim so the middle stays clear to fight in.
       * Everything here is one island so a bank of gear is one object. */
      for (let k = 0; k < 6; k++) {
        const a = 0.62 + k * 1.05;
        const c = Math.cos(a), s = Math.sin(a);
        const kk = 1 / Math.pow(Math.pow(Math.abs(c), 6) + Math.pow(Math.abs(s), 6), 1 / 6);
        const x = c * kk * RA * 0.72, z = s * kk * RB * 0.72;
        if (!siteOk(world, x, z, { clearance: 12, spawnClear: 14 })) continue;
        island(world, at(x, z), { seed: 9100 + k, yaw: -Math.atan2(z, x), span: 15, maker: 'plant' },
          (kit, local) => {
            addMachine(world, local(-3.2, 0), { kit, width: 4.2, height: 2.8, depth: 2.4,
              seed: 9110 + k, glowMat: M.glowCold });
            addTank(world, local(3.4, -2.6), { kit, radius: 1.7, height: 4.6, seed: 9120 + k });
            addStanchion(world, local(0.4, 3.2), { kit, height: 7.0, lamp: true, light: k % 2 === 0,
              color: 0xbcd8ff, intensity: 13, distance: 22, seed: 9130 + k });
            addPipeRun(world, [
              new THREE.Vector3(-3.2, 3.2, 1.2), new THREE.Vector3(0.4, 3.6, 1.8),
              new THREE.Vector3(3.4, 4.8, -0.8),
            ], { kit, count: 2, radius: 0.12, seed: 9140 + k });
          });
      }

      /* ── THE MAST at the centre of the pad, off-axis so the middle stays
       * clear: a platform needs a thing you can see it from, and this is the
       * only vertical inside the rail. */
      addAntenna(world, at(-16, 19), { height: 26, seed: 9200 });
      addPlinth(world, at(-16, 19), { width: 5.0, height: 0.7, seed: 9201, mat: M.darkSteel });

      /* ── The loose stuff a working pad has. Sparse and near the rim: a
       * landing deck is kept clear, which is what makes it a landing deck. */
      for (let k = 0; k < 5; k++) {
        const site = findSite(world, 26, 66, { clearance: 5, spawnClear: 12, maxSlope: 0.3 });
        if (site) addCrateStack(world, site.pos, { seed: 9220 + k, tiers: 2, columns: 2, yaw: rng() * TAU });
      }
      for (let k = 0; k < 9; k++) {
        const site = findSite(world, 20, 70, { clearance: 3, spawnClear: 12, maxSlope: 0.3 });
        if (site) world.addProp(rng() < 0.4 ? makeBarrel(world, site.pos) : makeCrate(world, site.pos, 0.8));
      }
      for (let k = 0; k < 5; k++) {
        const site = findSite(world, 22, 70, { clearance: 7, maxSlope: 0.3 });
        if (site) addDebrisField(world, site.pos, { radius: 7, seed: 9240 + k, count: 16 });
      }
      /* Salt, grit and shed plate over the deck: the grade a floor reads as
       * ground while you are standing on it, and the only INSTANCED thing on
       * the level — which is why it runs heavy rather than thin.
       *
       * `world-immersion` holds every outdoor level to five objects per draw
       * call, and it is right to: the rail, the lamps and the city are 224
       * hand-placed calls between them, so if the floor is not instanced this
       * level packs 4.0 and the check catches it. At cobble 2.4 it is 7.6,
       * and what that buys on the frame is a deck that reads as SALTED rather
       * than as poured — which is also the correct drawing for a platform that
       * has spent forty years in an ocean. */
      strewGround(world, { seed: 9260, radius: 76, inner: 3, spread: 0.30, mat: M.stoneDark,
        landmarks: 0.2, boulders: 1.0, cobble: 2.4 });

      world.notify('KAMINO', 'the rail is not everywhere');
    },
  },

  deeps: {
    name: 'The Cut',
    blurb: 'The excavation the works was taken out of. Whatever is still lit down here was not left on for you.',
    terrain: 'cavern',
    pool: ['b2', 'droideka', 'acolyte', 'acolyte', 'b1', 'beast', 'walker', 'b2'],
    groundColor: 0x252d31,
    spawnRadius: [24, 46],
    water: { level: 0.30, shallow: 0x2b4a52, deep: 0x080f16, sky: 0x1c2a34, bed: 0x1e2422 },
    atmosphere: {
      sky: false, bgColor: 0x05080b, fog: true, fogColor: 0x0a1014, fogDensity: 0.0108,
      /* THE DARKEST ATMOSPHERE IN THE GAME, and the numbers say so rather than
       * a comment: 0.9 of key against the intake's 5.6, 0.10 of ambient against
       * 0.34. What is left is the standing water reflecting whatever the
       * player is carrying, and the last rung of the descent takes even this
       * away — see Run.js, where the same level is entered twice and the
       * second time its key is 0.12. */
      sunColor: 0x8fb4c8, sunIntensity: 0.9, ambient: 0.10,
      skyColor: 0x24313a, groundColor: 0x252d31, elevation: 58, azimuth: 210,
      fillColor: 0x1e3038, fillIntensity: 0.34,
      // Exposure is where a dark level is actually made: the light is genuinely
      // gone, so the curve is opened up to keep what is left readable rather
      // than the key being quietly raised to fake it.
      exposure: 1.42, bloom: 0.50, saturation: 0.94,
      lift: [0.004, 0.008, 0.014], gain: [0.97, 1.0, 1.07],
      clouds: false, horizon: false,
    },
    ambience: { wind: 0.03, windFreq: 90, drone: 0.34 },
    dust: { count: 520, color: 0x5a6a72, opacity: 0.22, size: 20 },
    /**
     * MOSS, and it is the reason this level exists on `soil` rather than on a
     * deck. `ground-memory.mjs` holds one rule about cover — a preset that is
     * soil, or damp past 0.2, must carry a field, and nothing else may — and a
     * flooded excavation is the wettest floor in the game. What grows in a
     * pumped-out cut once the pumps stop is exactly this: a low mat over
     * everything the water has reached, and nothing at all on the ribs.
     *
     * 0.45, NOT 0.85, and the number was measured rather than felt. The cover
     * field solves to `clamp(0.24 + 0.72·density, 0.12, 0.95)` of the ground,
     * so at 0.85 it covered 86% of the cut — and `ground-cover.mjs` requires
     * the stone drifts to land where the cover is NOT, which at 86% they
     * cannot: there are fourteen points of bare floor on the whole level and
     * the drifts measured 88% covered against the level's 86%. A mat that
     * leaves genuine bare rock between its patches is both what a pumped-out
     * cut looks like and the only version of this the scatter can answer.
     */
    grass: 1.15,
    /* The pair is solved rather than picked. `grassPalette` builds a five-stop
     * species ramp by rotating the authored tints 80% of the way toward straw
     * (42°), green (92°) and glaucous (156°), and `ground-cover.mjs` requires
     * real fractions of all three — a field that is one colour is as false as
     * a field with no clearings.
     *
     * TWO attempts failed before this one and both are worth writing down. A
     * true blue-green — 0x40614e / 0x1d3128, which is what a cave moss wants
     * to be — sits at hue 145°, and `grassPalette` rotates the withered stop
     * only 80% of the way toward 42°, so it lands at 63° and 0.0% of the field
     * came out withered at all. Widening the authored pair to reach down into
     * the yellows then trips the check's own CONTROL, which requires the pair
     * itself to span under 12° — the whole point being that the five-stop
     * species ramp does the spreading, not the author.
     *
     * So the pair stays a tight lightness ramp (6.1° apart) at hue 95°, and
     * what makes it read as a cave is the LIGHT rather than the pigment: on
     * this level there is essentially none, and on the last rung of the
     * descent there is none at all. Measured: 86° of species span, 6%
     * withered / 85% green / 9% blue-green, median inside 1° of the author. */
    grassTint: [0x516a39, 0x2e4323],
    dress(world) {
      beginDressing(world, 20250805 + 87);
      cut(world, { seed: 8700 });
    },
  },

};

/**
 * The order the menu lists them in: the places you choose first, then the four
 * rooms of the descent in the order you meet them.
 */
export const LEVEL_ORDER = ['mustafar', 'temple', 'warship', 'colosseum', 'wood', 'kamino',
  'meadow', 'drifts', 'alpine', 'arena', 'intake', 'foundry', 'deeps'];

/**
 * DELETED LEVELS.
 *
 * The dune sea, the wash, Hangar Bay Nine and the dojo were removed at the
 * player's request, and they are gone — no aliases, no shim.
 *
 * There WAS a shim, four non-enumerable getters, because two lines outside this
 * module named `dunes` and the lane that deleted the levels could not edit
 * them: `Menu.DEFAULT_SETTINGS.level` and `World.loadLevel`'s
 * `LEVELS[key] || LEVELS.dunes` fallback. Both are fixed at the source now —
 * the default is a level that exists, and the fallback is `LEVEL_ORDER[0]`,
 * because a fallback that names a level is exactly how a deleted level stays
 * load-bearing after it is deleted.
 *
 * A saved profile pointing at a dead level still boots: it misses in LEVELS and
 * takes the first surviving level, which is what the fallback is for.
 *
 * The dojo needs one more sentence, because deleting it looks riskier than it
 * is. Training is no longer pinned to that room: `World.loadLevel` opens
 * DojoDirector on `L.training || settings.mode === 'training'`, and the
 * director places everything it spawns relative to the PLAYER and reads
 * nothing at all off the level. The eleven lessons now run in whichever
 * theatre the player picked, which is what the comment in World.js already
 * said they should. `Dojo.js` still exports `DOJO_LEVEL`; nothing imports it.
 */


/**
 * HOW EACH NEW GROUND BRINGS ENEMIES IN.
 *
 * `ARRIVAL_BY_TERRAIN` is keyed by a level's terrain string precisely so that
 * "a new level built on an existing terrain inherits the right arrival instead
 * of silently falling through to the default" (Arrivals.js) — and the flip
 * side of that is that a new GROUND has to say. Registered from here rather
 * than written into that table because this is the module that decides what
 * grounds exist; a level and its arrival are one decision.
 *
 * The rule is the one Arrivals.js states and nothing more: an open sky takes a
 * ship, an enclosed room takes a door.
 *
 *   mustafar    open sky over a lava sea. A gunship can fly in — and on a
 *               duelling map it should, because a march across a basalt shelf
 *               is eighty metres of watching.
 *   works       a hall with a roof on it. There is nothing for a ship to fly
 *               through, and there are blast doors in every fourth bay.
 *   foundry     the same, one floor down.
 *   cavern      cut rock with no sky at all; the adits ARE the doors.
 *   temple      a colonnaded hall. The enemies live here — they walk in
 *               through their own doorways.
 */
Object.assign(ARRIVAL_BY_TERRAIN, {
  mustafar: ['dropship', 'dropship', 'march'],
  works: ['gate'],
  foundry: ['gate'],
  cavern: ['gate'],
  temple: ['gate'],
  warship: ['gate'],
  colosseum: ['gate'],
  // Open sky over a bog — but a canopy no gunship can come through, and no
  // gate either. Whatever is in this wood walks out of it.
  bog: ['march', 'march', 'dropship'],
  // A platform in the middle of an ocean. There is no edge to march in from
  // and nothing to walk out of: everything that arrives here flies.
  kamino: ['dropship'],
});

/**
 * THE THING AT THE END OF THE WARSHIP, registered here for the same reason the
 * arrivals above are: a level and the set-piece it ends with are one decision,
 * and this is the module that decides what levels exist.
 *
 * It is deliberately NOT in `WaveDirector.unlockedAt`, which is the list the
 * fill is drawn from — so no amount of budget can ever buy one as an ordinary
 * body. The only path to the field is `_setPiece`, which fires on boss waves
 * and only on levels whose `pool` names it. Today that is exactly one level.
 *
 * `from: 10` AND NOT 5, and the reason is a structural property of
 * `_setPiece` rather than a feeling about pacing. That function floors its
 * spend at "twice the lightest rung", and then, if the ladder had exactly one
 * rung and it bought exactly one body, it buys a second. So a boss that is the
 * ONLY rung a wave can reach always arrives in a pair — measured: at `from: 5`
 * on this pool, where the droideka's rung is still two waves away and no
 * acolyte is in the pool at all, wave 5 fielded two of these. Two 1050-hp
 * duellists is not an escalation of one, it is the same fight twice at once,
 * which is the exact mistake the comment above `_setPiece` says it exists to
 * avoid. At 10 the walker's rung and the droideka's are both open, so the
 * ladder has three rungs and the doubling branch cannot fire.
 *
 * The cost of that is a boss wave 5 with no set-piece on it, and that is a
 * pre-existing consequence of a droid-only pool rather than something this
 * introduced: with `acolyte` out of the pool and the droideka gated to 6, the
 * wave-5 ladder was already empty before this rung existed. What wave 5 gets
 * instead is the whole budget spent on bodies, which on this level is a great
 * many B1s.
 *
 * THE THREAT NUMBER IS DERIVED, not felt. `_setPiece` spends the greater of
 * BOSS_SHARE (28%) of the wave budget and twice the lightest rung: at wave 10
 * that is 0.28 × 61 = 17.1. At 13 the general fits inside it and leaves 4.1,
 * which is under the walker's 12 and under the droideka's 5 — so he arrives
 * ALONE on the first boss wave that can afford him, and by wave 20, where the
 * spend is 45, he arrives with a walker and a droideka behind him. That is the
 * escalation, and it is the ladder doing it rather than a branch.
 */
Object.assign(ARCHETYPES, {
  bodyguard: {
    label: 'IG Bodyguard Droid', build: buildBodyguard, scale: 1.3, hp: 1050, mass: 240,
    speed: 4.4, toughness: TOUGHNESS.armour, melee: true, saber: true,
    /* An electrostaff, not a lightsaber, and the game already has the right
     * knob for that: `saberColor` indexes the crystal table and 5 is the cold
     * violet-white end of it, which is what an arc weapon looks like against a
     * ship's warm hazard lighting. The duel brain, the telegraph, the clash
     * and the blade lock all work off `saber` alone and need nothing else. */
    saberColor: 5, hilt: 'Sentinel', damage: 34, preferred: [1.8, 3.8],
    score: 3200, threat: 13, boss: true, hipHeight: 1.12,
    /* `armorPlus` is read by Enemy._boneToughness and sends the TORSO to
     * durasteel while leaving the limbs alone. On a boss that is the whole of
     * the counter-play: you are not going to cut this in half across the
     * chest, and you do not have to — the legs are still legs. */
    armorPlus: true,
  },
});
SET_PIECE.unshift({ type: 'bodyguard', from: 10 });

/**
 * THE MENAGERIE, and what makes each of them a different fight.
 *
 * "A wave of unique large creatures each fought differently, some ridden."
 *
 * These are NOT bosses, and that is the first decision. A `boss` archetype can
 * only reach the field through `_setPiece`, which fires on every fifth wave and
 * fields two or three bodies — so a roster of bosses is a roster you meet one
 * at a time on a schedule. What the brief asks for is a WAVE of them, so they
 * carry `unlockAt` instead and arrive as ordinary fill on the levels whose pool
 * names them, with `big: true` putting them under `heavyLimit` — one, plus one
 * per ten waves, times the party multiplier. Two players in the colosseum meet
 * two creatures at once at wave 1, which is exactly the intent.
 *
 * ── EACH FOUGHT DIFFERENTLY, and here is the mechanism rather than the claim.
 *
 * `Enemy._beastBrain` gates its move set on the fraction of health remaining:
 * phase 1 (over 66%) can only LUNGE, phase 2 (over 33%) adds the SWEEP, and
 * phase 3 adds the CHARGE, with the interval between attacks falling from 2.4 s
 * to 1.15 s across the three. So a creature's health pool is not only how long
 * it takes to kill — it is how much of the fight is spent in each move set, and
 * an animal with a quarter of the health reaches its most dangerous phase in a
 * quarter of the time. Add the hit radii, which scale with `scale`, and the
 * engagement band, which is `preferred`, and three numbers produce three fights:
 *
 *   the STALKER   420 hp, 8.6 m/s, scale 1.7, reach [1.8, 3.4]. It is through
 *                 all three phases inside about twelve seconds of contact, so
 *                 what you actually fight is the phase-3 animal: charge after
 *                 charge, 1.15 s apart, from an animal that outruns you. You
 *                 cannot walk away from it and you cannot out-trade it; you
 *                 parry it or you step off the line. It dies to two good cuts.
 *   the CHARGER   1250 hp, 6.0 m/s, scale 2.4, reach [2.2, 4.2]. The mirror
 *                 image: it spends most of the fight in phase 1, so it is a
 *                 long sequence of single telegraphed lunges with a 2.4 s gap
 *                 you can do work in — and the work is its LEGS, because three
 *                 of the four brings it down. Meeting it head-on is the one
 *                 thing that does not work: its frill and horns are carried in
 *                 front of its eyes, and the charge does 54.
 *   the ACKLAY    900 hp, 4.6 m/s, scale 2.9, reach [2.5, 5]. Already in the
 *                 game and left exactly as it is. It is the REACH problem —
 *                 the only one of the three that can hit you from outside your
 *                 own reach — and it stays a `boss`, so in the colosseum it
 *                 arrives on the fifth wave as the thing the show builds to.
 *
 * ── SOME RIDDEN. The charger carries a B2 (see src/game/Riders.js): a gunner
 * three metres up, out of the blade's reach, on something that will not stand
 * still. The pairing asks a question neither half asks alone — you cannot
 * answer the gun without answering the animal — and it is PAID FOR: the mount's
 * threat includes the rider's, so a wave with two crewed chargers in it is a
 * wave with six fewer droids, not a wave 30% over budget.
 *
 * `saddleThreat` reads that price off the archetype table, so the arithmetic
 * cannot drift out of step with the body it is paying for.
 */
Object.assign(ARCHETYPES, {
  charger: {
    label: 'Reek', build: (o) => buildQuadruped({ ...o, kind: 'charger' }),
    /* 1650 kg, and the ceiling is the FORCE GRIP rather than the animal. The
     * lift cap tops out at 1760 kg at the highest setting, and `force.mjs`
     * holds one rule about it: the cap has to be able to lift the heaviest
     * thing in the game. A 2400 kg mount would have been the one body in the
     * roster that no amount of Force could move, which is not a difficulty —
     * it is a power that silently stops working. */
    scale: 2.4, hp: 1250, mass: 1650,
    speed: 6.0, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 54, preferred: [2.2, 4.2], score: 2600,
    big: true, unlockAt: 1,
    /* The rider, and the price of it. Set below rather than here, because the
     * number is `ARCHETYPES.b2.threat` and reading it at declaration time
     * would freeze a copy of a value that lives in another module. */
    saddle: 'b2', threat: 0,
  },
  stalker: {
    label: 'Nexu', build: (o) => buildQuadruped({ ...o, kind: 'stalker' }),
    scale: 1.7, hp: 420, mass: 420,
    speed: 8.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 26, preferred: [1.8, 3.4], score: 1200, threat: 7,
    big: true, unlockAt: 1,
  },
});
/* Priced with what it carries. 11 of its own — between the walker's 12 and the
 * droideka's 5, which is where a 1250 hp animal that cannot shoot belongs — and
 * the B2 on its back at whatever a B2 costs. */
ARCHETYPES.charger.threat = 11 + saddleThreat('charger');
