/**
 * BATTLEFRONT BORZ — theatres.
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
  addInstanced, slabGeo, tubeUv, paintGeo, mergeGeos, torusGeo,
} from '../world/Props.js';
import { addHorizon, makeCoverField, ground, BODY_FADE } from '../world/Scenery.js';
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
import { attachHazard } from '../world/Hazard.js';
import { addSmokeColumns, smokeSites } from '../world/Smoke.js';
/**
 * COMMAND'S SEVEN BODIES, registered from here for exactly the reason the
 * warship's set-piece at the foot of this file is: "a level and the set-piece it
 * ends with are one decision, and this is the module that decides what levels
 * exist." Geonosis's pool is the only pool that names them, so the level and the
 * roster arrive together or `roster.mjs` fails — which is the check doing its
 * job rather than an inconvenience.
 *
 * THE IMPORT DIRECTION IS LOAD-BEARING and is written down in Command.js's own
 * header. Command.js imports Waves.js (for `WaveDirector`, which it extends);
 * Waves.js therefore may not import Command.js, and does not. This edge —
 * Levels → Command → Waves — is safe because Levels already imports Waves two
 * lines above, so Waves is fully evaluated before Command's class body runs.
 */
import { COMMAND_UNITS } from './Command.js';
/**
 * THE MACHINES, imported FOR THE SIDE EFFECT and for no other reason.
 *
 * `src/game/Vehicles.js` ends in `Object.assign(ARCHETYPES, …)` — the same way
 * the warship's set-piece is registered at the foot of this file, and for the
 * same stated reason: this is the module that decides what levels exist, and a
 * level and the bodies it fields are one decision.
 *
 * A BARE SIDE-EFFECT IMPORT IS EXACTLY THE SHAPE THAT ROTS, so it is written
 * down: without this line the four keys named in `LEVELS.geonosis.pool` below do
 * not exist, and `roster.mjs` fails. Without those pool entries, this line
 * creates four orphan archetypes and `roster.mjs` fails the other way. The two
 * halves landed in one commit and must stay together.
 *
 * There is an ORDERING HAZARD worth recording rather than rediscovering: the
 * vehicles' own check suite imports that module too, so in a full run
 * `ARCHETYPES` carries the four keys whether or not `src/` has imported them —
 * which means a forward run could pass on a tree where this line was missing and
 * `SABER_CHECK_ORDER=reverse` would fail. Naming them in a pool is what makes
 * both orders agree.
 */
import { buildGunship } from './Vehicles.js';
import { setDropshipModel } from './Arrivals.js';

/* …and the gunship the arrival director flies. Handed IN rather than imported
 * by Arrivals.js: that file is reached from Enemy.js via Dojo.js and Waves.js,
 * so an edge from it to Vehicles.js closes a cycle and runs Vehicles'
 * `Object.assign(ARCHETYPES, …)` inside ARCHETYPES' own temporal dead zone. It
 * was tried; it is a ReferenceError on boot. See `setDropshipModel`. */
setDropshipModel(buildGunship);

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

/* `spawnClear` lives in ./Spawn.js — a leaf, because Levels imports Arrivals
 * for ARRIVAL_BY_TERRAIN and Arrivals._sitePoint is the OTHER place in the
 * game that picks a spot for a body to appear in. Re-exported here so the
 * callers that already reach for it through Levels keep working. */
export { spawnClear } from './Spawn.js';

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
  /**
   * AND THE WATER GETS ITS TEETH, HERE, once, for every level that has any.
   *
   * `water` was a drawn plane and nothing else — `new Water(...)` in
   * World.loadLevel was its only reader in the game, so a lava sea, a canal of
   * molten metal and an ocean were all floors you could stand on at full
   * health. The hazard reads the SAME block the sheet is drawn from (see
   * src/world/Hazard.js), which is what stops the danger and the picture from
   * drifting apart the way `waterLevel` and `water.level` did on the Ember Shelf.
   * Attached in `beginDressing` rather than in thirteen `dress()` bodies for
   * the same reason the occupancy grid is reset here: a level that forgot the
   * line would be a level whose sea is scenery again.
   */
  if (world.level?.water) attachHazard(world, world.level.water);
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
  /**
   * AND NOT UNDER THE SEA — 902 rock chips were floating in the ocean on
   * Kamino.
   *
   * Every grade beds itself to `T.height(x, z)` and nothing asked whether that
   * height was under water, so a 180 m strew on a platform level put half its
   * stones on the sea floor and left them visible from the walkway as brown
   * pebbles lying on the waves. Measured on the shipped level before this:
   *
   *     scree  n=1761  below water 902 (51.2%)  minY −78.08 m  maxY 13.61
   *
   * The field is the right place for it rather than each caller: it is the one
   * thing every grade consults about where rock gathered, `addScree` and
   * `addBoulderCluster` both SKIP a site the field refuses, and a level with no
   * water (`waterLevel` −999) pays one comparison that is never true. Rock does
   * gather under water in the world; it is not what is being drawn here, which
   * is the litter you see from a walkway.
   *
   * ── AND THE FIRST VERSION OF IT EMPTIED A SWAMP ──────────────────────────
   *
   * `height <= waterLevel` is the right test for an ocean and the wrong one for
   * the Drowned Wood, whose whole subject is standing water you walk through.
   * It took that level from 1761 stones to 138 against a floor of 150 and put
   * `ground-cover` 12/14 — a fix for one level breaking another, caught only
   * because a suite two lanes away was counting.
   *
   * The two sheets are not the same thing and the levels already say so.
   * Measured depth below the waterline, sampled over each fight disc:
   *
   *     bog       submerged 833/4000   median 0.51 m   MAX 1.1 m
   *     kamino    submerged 2944/4000  median 64.6 m   max 78.2
   *     scoria    submerged 1617/4000  median 7.8 m    max 24.9
   *     mustafar  submerged 623/4000   median 3.0 m    max 6.7
   *
   * So there are two clauses and each is read off a declaration rather than
   * guessed. A sheet that DAMAGES you — `water.damage`, which scoria, mustafar
   * and the foundry all carry and which is lava or melt — is never ground you
   * see litter on, at any depth. And a harmless sheet is refused only where it
   * has stopped being shallow, which is not a number invented here: the water
   * shader mixes its shallow colour into its deep one at `BODY_FADE` per metre,
   * so the game's own drawing calls it half-deep at ln2/0.55 = 1.26 m. The Bog
   * is under that everywhere it is wet; Kamino is over it almost everywhere.
   * A shore you can see the bottom of is a shore.
   */
  const T = world.terrain;
  const sea = T && T.waterLevel > -900 ? T.waterLevel : null;
  const scalds = !!world.level?.water?.damage;
  const WADE = Math.LN2 / BODY_FADE;
  const f = (x, z) => {
    if (sea !== null) {
      const depth = sea - T.height(x, z);
      if (depth > 0 && (scalds || depth > WADE)) return 0;
    }
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


/* ══════════════════════════════════════════════════════════════════════ */
/*  SNOW FORMS — the White Pass's ground furniture                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE ROCKS ARE GONE FROM THE WHITE PASS, AND THIS IS WHAT IS THERE INSTEAD.
 *
 * Second time of asking: "i already told you to get rid of the rocks in the
 * white pass but they're still there it feels like a reskin of the dunes map."
 * The first answer was a TINT — the same stone field, the same fourteen
 * outcrops, re-materialled from the desert's warm varnish to a cold one — and
 * its own note said out loud that "the counts are untouched, and that is
 * deliberate". That was the wrong call and the note is what makes it easy to
 * see why: the complaint has never been about the hue. It is that the shapes
 * on the ground are a desert's shapes.
 *
 * `assets/reference/maps/alpine/hoth.jpeg` settles it. There is not one stone
 * in that frame, not one spire, not one chip. Everything in it is a SNOW form:
 *
 *   · sastrugi — long low ridges combed by the wind, all lying one way
 *   · drift humps — smooth domes where the wind dropped its load
 *   · one big rounded massif in the mid-ground, which is a hill under snow
 *     rather than a crag with snow on it
 *
 * So the White Pass strews none of `strewGround`'s three grades and none of
 * `addOutcrop`'s bedded crags. It gets these, they are all `M.snowPack`, and
 * the only thing that distinguishes one from the ground it stands on is VALUE
 * and a blue shadow — which is exactly what the reference does and exactly
 * what the last pass's own note said the reference does, one paragraph before
 * it decided to keep the stones.
 *
 * THE WIND IS THE COMPOSITION. Every sastruga is aligned to the level's own
 * `dust.wind.from`, ±12°, which is what makes a snowfield read as a snowfield
 * from a standing eye: the ground tells you which way the weather comes from.
 * That is one direction for the whole level and it is READ from the level
 * rather than typed here, so a level that re-authors its wind re-combs its
 * ground with it.
 */

/** A sastruga: a long, low, wind-combed ridge. Steep on the windward end,
 *  drawn out to nothing downwind, which is the asymmetry that makes it read
 *  as carved rather than as a lump. */
function sastrugaGeo(seed) {
  const q = makeRng(seed);
  const N = 13, M = 7;                     // along, across
  const pos = [], idx = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // the profile along the wind: a fast rise and a long tail
    const h = Math.pow(Math.sin(Math.pow(t, 0.55) * Math.PI), 1.35);
    const halfW = (0.34 + 0.66 * Math.sin(t * Math.PI)) * (0.8 + q() * 0.4);
    for (let j = 0; j < M; j++) {
      const u = j / (M - 1);
      const across = (u - 0.5) * 2;
      const lift = h * Math.cos(across * Math.PI * 0.5) * (0.88 + q() * 0.24);
      pos.push((t - 0.5) * 2, lift - 0.12, across * halfW);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = a + M;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A drift hump: a smooth dome with a low-frequency wobble, flattened. */
function driftHumpGeo(seed) {
  const q = makeRng(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const ph = [q() * TAU, q() * TAU, q() * TAU];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const w = 1 + 0.16 * Math.sin(x * 2.1 + ph[0]) + 0.13 * Math.sin(z * 1.7 + ph[1])
                + 0.09 * Math.sin((x + z) * 3.3 + ph[2]);
    // squashed and sunk: a drift is a third as tall as it is wide, and its
    // skirt is BELOW the ground so it beds into whatever it lands on
    p.setXYZ(i, x * w, y * w * 0.34 - 0.18, z * w);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A massif: the big rounded white hill in the reference's mid-distance. It is
 * cover, so unlike everything else here it carries a collider — the ONLY
 * furniture on this level that does, which is the honest reading of a place
 * whose ground is otherwise unbroken.
 */
function addSnowMassif(world, pos, opts = {}) {
  const q = makeRng(opts.seed ?? 1);
  const w = opts.size ?? 7, h = opts.height ?? 5;
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const ph = [q() * TAU, q() * TAU, q() * TAU, q() * TAU];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.20 * Math.sin(x * 1.3 + ph[0]) + 0.16 * Math.sin(z * 1.1 + ph[1])
                + 0.11 * Math.sin(y * 2.0 + ph[2]) + 0.07 * Math.sin((x - z) * 2.7 + ph[3]);
    p.setXYZ(i, x * k * w, y * k * h - h * 0.42, z * k * w * (0.7 + q() * 0.05));
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, propMaterials().snowPack);
  mesh.position.copy(pos);
  mesh.rotation.y = opts.yaw ?? 0;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  world.scene.add(mesh);
  world.statics.push(mesh);
  world.physics?.addStaticBox?.(pos.clone().add(new THREE.Vector3(0, h * 0.12, 0)),
    new THREE.Vector3(w * 0.66, h * 0.52, w * 0.52),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, mesh.rotation.y, 0)),
    { friction: 0.62 });
  return mesh;
}

/** Comb the whole field. Returns the draw calls spent. */
function strewSnowForms(world, opts = {}) {
  const T = world.terrain;
  const M = propMaterials();
  const seed = opts.seed ?? 9900;
  const R = opts.radius ?? 150;
  const q = makeRng(seed);
  /* THE WIND, read off the level rather than typed here. `dust.wind.from` is a
   * compass bearing in degrees; the ridges lie ALONG it. */
  const from = ((world.level?.dust?.wind?.from ?? 0) * Math.PI) / 180;
  const field = makeCoverField({ seed: seed + 5, amount: opts.spread ?? 0.5,
    patch: 52, grain: 15, extent: R });
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const UPY = new THREE.Vector3(0, 1, 0);
  let calls = 0;

  /* ── sastrugi, in two lengths, all lying with the wind.
   *
   * IN FIELDS, not spread. Wind-carved ground is patchy — the comb bites where
   * the snow is packed and leaves the soft ground alone — and it has to be
   * patchy for a second reason too: `ground-cover.mjs` measures every level's
   * instanced litter against a Poisson control and a plain `drift` scatter
   * cannot beat its 0.70 bound, because uniform-within-the-accepted-area IS
   * uniform at the nearest-neighbour scale. Measured on this level: 0.734
   * spread, 0.53 in fields. The check and the drawing want the same thing. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    drift(world, {
      field: (x, z) => field.at(x, z), count: Math.round((opts.ridges ?? 1) * (v ? 34 : 52)),
      rmin: 2, rmax: R, clearance: 0, maxSlope: 0.52, tries: 6,
    }, (p) => {
      const n = 5 + (q() * 8 | 0);
      for (let i = 0; i < n; i++) {
        /* Elongated ALONG the wind, because a comb-mark field is a set of
         * parallel streaks and not a round patch of them. */
        const rr = (v ? 9.0 : 5.5) * Math.sqrt(q()), a = q() * TAU;
        const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr;
        const x = p.x + ox * Math.cos(from) * 1.9 - oz * Math.sin(from) * 0.5;
        const z = p.z + ox * Math.sin(from) * 1.9 + oz * Math.cos(from) * 0.5;
        const len = (v ? 3.4 : 1.5) * (0.7 + q() * 0.9);
        _q.setFromAxisAngle(UPY, from + (q() - 0.5) * 0.42);
        _s.set(len, (0.30 + q() * 0.34) * (v ? 1.25 : 1), 0.9 + q() * 0.7);
        list.push(_m.compose(_p.set(x, T ? T.height(x, z) : 0, z), _q, _s).clone());
      }
    });
    if (addInstanced(world, sastrugaGeo(seed + 20 + v), M.snowPack, list,
      new THREE.Vector3(), { name: 'snowSastruga' + v, castShadow: false })) calls++;
  }

  /* ── drift humps, in clumps: the wind piles them where it is already piling. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    drift(world, {
      field: (x, z) => field.at(x, z), count: Math.round((opts.humps ?? 1) * (v ? 28 : 46)),
      rmin: 4, rmax: R, clearance: 0, maxSlope: 0.45, tries: 7,
    }, (p) => {
      const n = 3 + (q() * 5 | 0);
      for (let i = 0; i < n; i++) {
        const a = q() * TAU, rr = (v ? 7.5 : 4.2) * Math.sqrt(q());
        const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
        const s = (v ? 2.2 : 0.95) * (0.6 + q() * 0.9);
        _q.setFromAxisAngle(UPY, q() * TAU);
        _s.set(s, s * (0.7 + q() * 0.6), s * (0.72 + q() * 0.5));
        list.push(_m.compose(_p.set(x, T ? T.height(x, z) : 0, z), _q, _s).clone());
      }
    });
    if (addInstanced(world, driftHumpGeo(seed + 40 + v), M.snowPack, list,
      new THREE.Vector3(), { name: 'snowDrift' + v, castShadow: v === 1 })) calls++;
  }
  return calls;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SWAMP FLOOR                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A BOG FLOOR IS NOT A FIELD OF ANYTHING, AND THAT IS THE FOURTH ATTEMPT AT
 * THIS AND THE FIRST ONE THAT IS NOT A GRASS TUNING.
 *
 * The note, in full, on its third repetition: "get rid of the grass on drowned
 * wood completely… it doesn't look stylistic and just looks like complete
 * trash… you need to do something completely different because it's a 1/10
 * right now."
 *
 * The three passes before this one were: a browner grass, a sparser grass, and
 * a grass with a `swamp` multiplier row on its tier table. All three were the
 * same move, and the reference says why all three were doomed before they were
 * written. `assets/reference/maps/drowned-wood/dagobah.jpeg` has **no grass in
 * it at all** — no upright cover of any kind. What is on that floor is four
 * things and every one of them is HORIZONTAL:
 *
 *   · standing water, which is the brightest thing in the frame
 *   · low banks of matted litter between the channels
 *   · buttress roots flaring off the foot of every trunk
 *   · tangles of bare dead branches, lying in and half under the water
 *
 * An upright blade is the one shape that is not in the picture. So the fix is
 * not a better field — it is DELETING the field and building the floor out of
 * geometry, which is what this is. `grass: 0` on the level, and this instead.
 *
 * WHY IT IS AFFORDABLE. Eight InstancedMeshes, against `world-immersion`'s 520
 * draw-call budget and the wood's own existing spend. Every kind is authored
 * twice so the eye cannot lock onto one silhouette — the crowd note in
 * HANDOFF §6.1b is the same finding from the other end, and two variants is
 * where the cost curve and the read cross for something you are looking DOWN
 * at rather than across at.
 *
 * WHY NOTHING HERE IS A COLLIDER. All of it is under 40 cm and the player
 * walks over it. A litter bank you can trip on is a bog you cannot fight in,
 * and 1,500 tiny static boxes is exactly the linear scan `Trees.js` already
 * has a paragraph about.
 */

/** An irregular low mound of matted debris, sitting ON the ground.
 *
 *  The rim is BELOW zero and the crown is above it, so the disc beds itself
 *  into whatever slope it lands on instead of standing off the hill on one
 *  edge — the same problem `Scenery.js`'s contact quads solve by tilting to
 *  the ground normal, answered here by burying the skirt, because a mound has
 *  a thickness to bury and a shadow quad does not. */
function litterMoundGeo(r, seed, sides = 11) {
  const q = makeRng(seed);
  const pos = [], idx = [];
  pos.push(0, r * 0.16, 0);                       // the crown
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    const rr = r * (0.58 + q() * 0.42);
    pos.push(Math.cos(a) * rr, -r * 0.22, Math.sin(a) * rr);
  }
  for (let i = 0; i < sides; i++) idx.push(0, 1 + ((i + 1) % sides), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One root: a tapered tube that leaves the trunk high and reaches the ground
 *  a couple of metres out, bending as it goes. */
function rootStrandGeo(q, opts = {}) {
  const up = opts.up ?? 1.35, out = opts.out ?? 1.9;
  const a = opts.angle ?? 0;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    /* The profile is the whole read. A root does not leave the trunk on a
     * straight line — it comes out nearly horizontally at the top, drops
     * steeply through the middle and flattens again where it enters the
     * ground, which is `t^1.7` against `t^0.55`. A straight strand reads as a
     * guy wire. */
    const rad = out * Math.pow(t, 0.55) * (0.55 + opts.reach * 0.45);
    const y = up * (1 - Math.pow(t, 1.7));
    const wob = (q() - 0.5) * 0.16 * t;
    pts.push(new THREE.Vector3(Math.cos(a + wob) * rad, y, Math.sin(a + wob) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  // 5 radial segments and 5 along: a root is read by its LINE, and the eye
  // is never closer to one than a metre and a half.
  const g = new THREE.TubeGeometry(curve, 5, opts.r ?? 0.13, 5, false);
  // taper it by hand — TubeGeometry has one radius
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.floor(i / 6) / 5;
    const k = 1 - t * 0.62;
    const cx = pts[Math.min(4, Math.round(t * 4))];
    p.setXYZ(i, cx.x + (p.getX(i) - cx.x) * k, cx.y + (p.getY(i) - cx.y) * k,
      cx.z + (p.getZ(i) - cx.z) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A buttress: five to eight roots off one stem, splayed all the way round. */
function rootFlareGeo(seed) {
  const q = makeRng(seed);
  const n = 5 + Math.floor(q() * 4);
  const parts = [];
  const a0 = q() * TAU;
  for (let i = 0; i < n; i++) {
    parts.push(rootStrandGeo(q, {
      angle: a0 + (i / n) * TAU + (q() - 0.5) * 0.5,
      up: 1.0 + q() * 0.9, out: 1.5 + q() * 1.3, reach: q(),
      r: 0.10 + q() * 0.07,
    }));
  }
  // the stem they all come off, so the flare is not a spider with no body
  const stem = new THREE.CylinderGeometry(0.30, 0.46, 1.7, 7, 1, true);
  stem.translate(0, 0.72, 0);
  parts.push(stem);
  return mergeGeos(parts);
}

/** A tangle of bare dead branches: the black spiky note in every plate. */
function deadwoodGeo(seed) {
  const q = makeRng(seed);
  const n = 6 + Math.floor(q() * 5);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const len = 0.7 + q() * 1.5;
    const g = new THREE.CylinderGeometry(0.010 + q() * 0.014, 0.028 + q() * 0.024, len, 4, 1, true);
    g.translate(0, len * 0.5, 0);
    /* Shallow, not upright. A stick standing on its end is a spear; what is in
     * the plate is deadfall lying at 15-45 degrees across the bank, with the
     * odd one propped higher by whatever it fell against. */
    const tilt = 0.9 + q() * 0.7;
    const e = new THREE.Euler(tilt, q() * TAU, (q() - 0.5) * 0.7);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
    g.translate((q() - 0.5) * 0.7, 0.04 + q() * 0.16, (q() - 0.5) * 0.7);
    parts.push(g);
  }
  return mergeGeos(parts);
}

/** A root that leaves the ground and comes back — the arch you step over. */
function rootArchGeo(seed) {
  const q = makeRng(seed);
  const span = 1.6 + q() * 2.2, rise = 0.45 + q() * 0.55;
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3((t - 0.5) * span, Math.sin(t * Math.PI) * rise - 0.14,
      (q() - 0.5) * 0.22));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 7, 0.10 + q() * 0.06, 5, false);
}

/**
 * Lay the whole floor. Everything is placed through the cover field so the
 * banks are banks and the channels are channels — `drift`'s own header is the
 * argument, and it applies here harder than anywhere: a bog whose litter is
 * spread evenly is a carpet, and what makes this floor read is that the
 * matted parts are matted and the water between them is open.
 */
function strewSwampFloor(world, opts = {}) {
  const T = world.terrain;
  const M = propMaterials();
  const seed = opts.seed ?? 8800;
  const R = opts.radius ?? 150;
  const wet = opts.wet ?? 0;
  const q = makeRng(seed);
  /* The litter's own field, coarser than the tree field: debris collects in
   * fewer and bigger places than trunks stand in. */
  /* THE FIELD IS SHARPENED, and the exponent is measured rather than picked.
   * `ground-cover.mjs` holds every level's litter to a Clark–Evans ratio under
   * 0.70 against a Poisson control — the whole of "a drift, not a sprinkle" —
   * and the wood's pooled litter came out 0.871 at `amount: 0.44` taken flat.
   * Squaring the field keeps the same swathes and empties their margins, which
   * is what a bank actually looks like: the debris does not thin out toward
   * the water, it STOPS at it. 0.871 → 0.605. */
  const raw = makeCoverField({ seed: seed + 3, amount: opts.spread ?? 0.40,
    patch: 30, grain: 9, extent: R });
  const field = { at: (x, z) => { const v = raw.at(x, z); return v * v; } };
  const _m = new THREE.Matrix4(), _p2 = new THREE.Vector3();
  const _qt = new THREE.Quaternion(), _s2 = new THREE.Vector3();
  const UPY = new THREE.Vector3(0, 1, 0);
  const put = (list, x, z, y, yaw, sc, lift = 0) => {
    _qt.setFromAxisAngle(UPY, yaw);
    _s2.set(sc, sc * (0.72 + q() * 0.56), sc);
    list.push(_m.compose(_p2.set(x, y + lift, z), _qt, _s2).clone());
  };
  /**
   * A BANK, NOT A SPRINKLE — and this is the shape of the whole floor.
   *
   * The first draft placed every item through `drift` on its own, which is
   * uniform-disc-plus-rejection: 460 litter mounds over a 130 m disc is ONE
   * EVERY HUNDRED SQUARE METRES, which is not a mat, it is confetti. It
   * measured as confetti too — `ground-cover.mjs` pooled it with the stone and
   * the level's Clark–Evans went 0.596 → 0.801 against a 0.70 bound. The
   * check was right and the drawing was wrong in the same direction, which is
   * the useful case.
   *
   * What a bog floor actually is: debris CONTIGUOUS where the water dropped it
   * and absent everywhere else. So `drift` picks the banks — a few dozen of
   * them, through the field, so they land where the field says litter
   * collects — and each bank is then filled to overlapping density. The
   * spray is `sqrt`-distributed in radius so a bank is denser at its middle
   * than at its edge rather than being a disc of even confetti.
   */
  const bankify = (list, opts2, geoScale) => {
    const banks = opts2.banks, per = opts2.per, rad = opts2.rad;
    drift(world, {
      field: (x, z) => field.at(x, z), count: banks,
      rmin: opts2.rmin ?? 4, rmax: opts2.rmax ?? R, clearance: opts2.clearance ?? 0,
      minHeight: opts2.minHeight, maxSlope: opts2.maxSlope, tries: 7,
    }, (p) => {
      const n = per * (0.6 + q() * 0.8) | 0;
      for (let i = 0; i < n; i++) {
        const a2 = q() * TAU, rr = rad * Math.sqrt(q());
        const x = p.x + Math.cos(a2) * rr, z = p.z + Math.sin(a2) * rr;
        const y = T ? T.height(x, z) : 0;
        if (opts2.minHeight !== undefined && y < opts2.minHeight) continue;
        put(list, x, z, y, q() * TAU, geoScale(), opts2.lift ?? 0);
      }
    });
  };
  let calls = 0;

  /* ── 1. THE BANKS. Two variants, both flat, both dark, and the only thing
   * on this level whose job is to CLOSE GROUND. This is the rung the grass
   * field used to be and it does it lying down. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    bankify(list, { banks: Math.round((opts.litter ?? 1) * (v ? 26 : 34)), per: v ? 9 : 16,
      rad: v ? 5.4 : 3.4, rmin: 3, rmax: R, minHeight: wet - 0.10 },
    () => 0.55 + q() * (v ? 1.7 : 0.75));
    if (addInstanced(world, litterMoundGeo(1, seed + 40 + v, v ? 13 : 9), M.litterMat,
      list, new THREE.Vector3(), { name: 'bogLitter' + v, castShadow: false })) calls++;
  }

  /* ── 2. THE BUTTRESSES. On the hummocks, where the trunks are — a root
   * flare standing in open water is a mangrove and this is not one. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    bankify(list, { banks: Math.round((opts.roots ?? 1) * 14), per: 4, rad: 4.2,
      rmin: 6, rmax: R * 0.92, clearance: 2.4, minHeight: wet + 0.10, maxSlope: 0.55 },
    () => 0.72 + q() * 0.85);
    if (addInstanced(world, rootFlareGeo(seed + 60 + v), M.rootWet, list,
      new THREE.Vector3(), { name: 'bogRoots' + v })) calls++;
  }

  /* ── 3. THE DEADFALL. The spiky black note, and the thing that makes the
   * water read as shallow: a branch lying half in it has a wet line on it.
   * Deadfall gathers hardest of all — a fallen crown does not distribute
   * itself, it lands in one place — so the banks are few and tight. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    bankify(list, { banks: Math.round((opts.deadwood ?? 1) * 16), per: 7, rad: 2.6,
      rmin: 4, rmax: R, minHeight: wet - 0.35 },
    () => 0.7 + q() * 0.8);
    if (addInstanced(world, deadwoodGeo(seed + 80 + v), M.rootWet, list,
      new THREE.Vector3(), { name: 'bogDeadfall' + v, castShadow: false })) calls++;
  }

  /* ── 4. THE ARCHES, and they are the only rung here with a moss cap: one
   * saturated note on the one shape that stands clear of the water. */
  for (let v = 0; v < 2; v++) {
    const list = [];
    bankify(list, { banks: Math.round((opts.arches ?? 1) * 15), per: 4, rad: 4.4,
      rmin: 8, rmax: R * 0.9, clearance: 1.6, minHeight: wet - 0.05 },
    () => 0.8 + q() * 0.7);
    if (addInstanced(world, rootArchGeo(seed + 100 + v), v ? M.mossWet : M.rootWet, list,
      new THREE.Vector3(), { name: 'bogArch' + v })) calls++;
  }
  return calls;
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
  /* R IS THE FIGHT AND SHELL IS THE ROOM, and they are two numbers now because
   * the depth rule made them different things. R is where the plant, the bay
   * grid, the gantries and the drift stop — unchanged at 66, because the note
   * this pass answers is about the walls and not about the floor. SHELL is
   * where the wall actually is, and it went out to 94 so there is somewhere for
   * three ranks of structure to stand between the two. */
  const R = 66;
  const SHELL = 94;
  const lamp = opts.lampColor ?? 0xffb04a;
  const hot = !!opts.hot;

  // The roof first, because everything below is lit under it.
  roof(world, { height: 16.5, half: SHELL + 2, well: opts.well ?? 0, shadow: !!opts.well,
    mat: M.hull, beamCount: 11 });

  /* ── THE DEPTH RANKS, and this is the fix for "you're in a large box".
   *
   * The rule is the Temple's and its own comment derives it: an interior stops
   * being a box when there are three more colonnades between the player and the
   * wall. Everything below this line is the works floor exactly as it was — the
   * bay grid, the gantries, the canal, the drift — and it all stops at 56 m,
   * which is why the player could find the wall in one glance.
   *
   * So the shell went out to 94 (see the `foundry` preset) and the 38 m of new
   * room is filled with THREE RANKS of structure at 62, 76 and 90: stanchions
   * carrying trusses, with the flare of a working floor between them. From
   * anywhere in the fight the wall is behind three ranks, and every sight line
   * out of the room ends on machinery rather than on plate.
   *
   * IT COSTS FOUR DRAW CALLS, which is the only reason it is affordable on a
   * level already spending 386 of the 520 `world-immersion` allows. A rank is
   * two instanced meshes' worth of geometry — the post and the truss — and the
   * ranks share them, so three ranks of 96 stanchions come to two calls, and
   * the collider is a static box per post.
   *
   * They are OUT OF THE FIGHT on purpose: the innermost rank is 6 m outside the
   * bay grid's last cell, so nothing here changes what the floor plays like. It
   * changes what it looks like past the last machine, which is the note. */
  {
    const posts = [], trusses = [], boxes = [];
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    const pp = new THREE.Vector3(), ss = new THREE.Vector3();
    for (const [rad, h] of [[62, 12.5], [76, 11.0], [90, 9.5]]) {
      const n = Math.max(12, Math.round(rad * 8 / 14));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rad * 0.013;
        // walk the RECTANGLE, not a circle: this is a room
        const c = Math.cos(a), s = Math.sin(a);
        const kk = 1 / Math.max(Math.abs(c), Math.abs(s));
        const x = c * kk * rad, z = s * kk * rad;
        if (!T.inBounds(x, z, 3)) continue;
        const y = T.height(x, z);
        const yaw = Math.abs(c) > Math.abs(s) ? 0 : Math.PI / 2;
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        posts.push(mm.clone().compose(pp.set(x, y, z), qq, ss.set(1, h / 10, 1)));
        boxes.push({ x, y, z, h });
        // the truss on to the next post of this rank, which is what makes a
        // row of posts read as a building
        const a2 = ((i + 0.5) / n) * TAU + rad * 0.013;
        const c2 = Math.cos(a2), s2 = Math.sin(a2);
        const k2 = 1 / Math.max(Math.abs(c2), Math.abs(s2));
        const x2 = c2 * k2 * rad, z2 = s2 * k2 * rad;
        if (!T.inBounds(x2, z2, 3)) continue;
        const span = Math.hypot(x2 - x, z2 - z) * 2.0;
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(x2 - x, z2 - z));
        trusses.push(mm.clone().compose(pp.set(x2, T.height(x2, z2) + h - 0.6, z2), qq,
          ss.set(1, 1, span)));
      }
    }
    const postGeo = mergeGeos([
      slabGeo(1.5, 0.4, 1.5, { tile: 2.4, seg: 2 }).translate(0, 0.2, 0),
      slabGeo(0.85, 10.0, 0.85, { tile: 2.4, seg: 3 }).translate(0, 5.2, 0),
      slabGeo(1.9, 0.5, 1.9, { tile: 2.4, seg: 2 }).translate(0, 10.3, 0),
    ]);
    const trussGeo = mergeGeos([
      slabGeo(0.6, 0.5, 1.0, { tile: 2.4, seg: 2 }),
      slabGeo(0.35, 1.5, 0.30, { tile: 1.6, seg: 2 }).translate(0, 0.9, 0),
    ]);
    addInstanced(world, postGeo, M.darkSteel, posts, V(0, 0, 0), { name: 'worksRank' });
    addInstanced(world, trussGeo, M.rust, trusses, V(0, 0, 0),
      { name: 'worksTruss', castShadow: false });
    for (const b of boxes) {
      // capped at 9 m for the reason the Temple's columns are — see the note
      // there: a near-list rejects on `box.radius`, and nothing reachable is
      // above nine metres
      const bh = Math.min(9, b.h);
      world.physics.addStaticBox(new THREE.Vector3(b.x, b.y + bh * 0.5, b.z),
        new THREE.Vector3(0.45, bh * 0.5, 0.45), new THREE.Quaternion(), { friction: 0.85 });
    }
    /* ── AND THE LIGHT THAT SAYS THERE IS SOMETHING OUT THERE. The one thing
     * the Temple's references have that this room did not is a bright slot in
     * the far distance: without it the depth is dark and reads as fog. Hazard
     * lamps up the outer rank, instanced, so the far end of the room is a
     * receding row of amber points rather than a wall. */
    const slots = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + 0.2;
      const c = Math.cos(a), s = Math.sin(a);
      const kk = 1 / Math.max(Math.abs(c), Math.abs(s));
      const x = c * kk * 88, z = s * kk * 88;
      if (!T.inBounds(x, z, 3)) continue;
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.abs(c) > Math.abs(s) ? 0 : Math.PI / 2);
      slots.push(mm.clone().compose(pp.set(x, T.height(x, z) + 7.0, z), qq, ss.set(1, 1, 1)));
    }
    addInstanced(world, slabGeo(0.5, 3.2, 0.9, { tile: 1.4, seg: 2 }),
      opts.hot ? M.glowRed : M.glowAmber, slots, V(0, 0, 0),
      { name: 'worksSlot', castShadow: false });
  }

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
    /**
     * AND THE BLAST DOOR IS IN THE RECESS.
     *
     * This comment block has said "every fourth bay is a blast door recess"
     * since the room was written, and the arrivals table two thousand lines
     * down justifies the works' gate arrival with "there are blast doors in
     * every fourth bay". There were none. `world.doors` was allocated,
     * disposed, stepped every frame and handed to the blade solver every frame,
     * and it was empty on all thirteen levels — `BlastDoor` (src/world/Props.js)
     * is a finished object with a kerf texture, a discard-through hole, a real
     * collider, capsules for the blade and a breach that drops the slug out,
     * and nothing in the game had ever built one.
     *
     * So the recess gets the door it is a recess for: 4.4 × 5.2, which is the
     * opening `addBrokenWall` cuts, and the wall's collider now stops at the
     * jamb rather than running straight through the doorway. Cut through one
     * and you are in the shell, which is where a blast door in the outer wall
     * of a foundry goes.
     */
    if (i % 4 === 1 && !failed) {
      const door = new BlastDoor(world, {
        position: V(x, T.height(x, z) + 2.6, z),
        quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        width: 4.36, height: 5.16, thickness: 0.42, color: 0x5f6670,
      });
      world.addDoor ? world.addDoor(door) : world.doors.push(door);
    }
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
   * clear so the fight has a spine.
   *
   * 5.2 AND 4.4 m, NOT THE 6.4 AND 5.4 FIRST WRITTEN, and the number is the
   * player's own reach. A Force double jump was measured headless with
   * unlimited Force, sweeping the second jump across every frame of the arc:
   * 6.18 m above the take-off point, best at frame 40. A deck top sits at
   * H + 0.16, so a 6.4 m gantry stood 0.38 m over the ceiling of the highest
   * jump in the game and a 7.2 m one 1.18 m over it — and the only route up
   * that this game draws is a LADDER, which is geometry with no collider and
   * nothing to climb it with (see the ladder in `addGantry`). So every deck in
   * the game was furniture: you could see it, you could never stand on it, and
   * nothing spawned up there either. At 5.2 the deck is 0.8 m inside the jump,
   * which is the margin that makes it a place you go rather than a trick. */
  for (const side of [-1, 1]) {
    addGantry(world, at(side * (R - 16), -18), { length: 30, height: 5.2, yaw: Math.PI / 2, seed: seed + 300 + side, lights: opts.lights !== false });
    addGantry(world, at(side * (R - 16), 24), { length: 24, height: 4.4, yaw: Math.PI / 2, seed: seed + 310 + side, lights: opts.lights !== false });
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
    if (rng() < 0.3) makeBarrel(world, pos); else makeCrate(world, pos, 0.85);
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
   * still standing, still empty. 5.2 and 4.4, not 7.2 and 6.2 — a deck the
   * player cannot reach is scenery, and the measured ceiling of a full double
   * Force jump is 6.18 m. The note over the works' own gantries has the whole
   * measurement. */
  addGantry(world, at(-30, -40), { length: 40, height: 5.2, yaw: 0.3, seed: seed + 500, lights: false });
  addGantry(world, at(28, 34), { length: 32, height: 4.4, yaw: 2.1, seed: seed + 510, lights: false });
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
  /* WHAT WAS LEFT LYING ON THE FLOOR — and until the water line was fixed,
   * almost none of it arrived. `minHeight: wet + 0.3` is the right gate (a
   * crate does not sit in a sump) but it was being asked against a sheet at
   * +0.30 over a floor whose median is -1.09, so it rejected 92% of the room
   * and this level shipped with nothing loose on it at all. Measured by
   * sliceable.mjs once its own survey started attaching `world.level`: 4
   * reachable crate-sized objects on the whole level, none of them cuttable.
   * 18, because a working floor that was walked away from has drums and boxes
   * on it, and because they are the only things down here a blade can take
   * apart. */
  for (let k = 0; k < 18; k++) {
    const site = findSite(world, 12, 70, { clearance: 3.2, maxSlope: 0.32, minHeight: wet + 0.3, tries: 18 });
    if (site) if (rng() < 0.4) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.8);
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

/**
 * AN ORDER OF COLUMNS, AND THE ONLY REASON THE DEPTH RULE IS AFFORDABLE.
 *
 * The rule is written out over the Temple below: an interior stops being a box
 * when there are three more colonnades between the player and the wall. Six
 * ranks a side over 278 m of hall is 228 columns, and 228 of anything placed
 * one at a time is 228 draw calls before the level has a floor — the budget
 * `world-immersion` holds a level to is 520 and the foundry already spends 386.
 * So the order is INSTANCED, and it comes to four calls:
 *
 *   the SHAFT       one geometry, scaled (r, h, r) per instance. The
 *                   bronze-and-pale alternation the references show is
 *                   per-INSTANCE colour on one material rather than two
 *                   materials, which is what keeps it at one call; the helical
 *                   banded fillet — the diagonal ribbon wrapping every column
 *                   in `temple after battle` — is VERTEX colour underneath it,
 *                   and the two multiply.
 *   the BASE        a stepped drum, scaled uniformly by r.
 *   the CAPITAL     the same, lifted to the top of the shaft.
 *   the ENTABLATURE the beam from each column to the next, which is what turns
 *                   a row of posts into an arcade. Without it the eye reads
 *                   sticks; with it, it reads a building, and it is the single
 *                   cheapest element here.
 *
 * WHAT INSTANCING COSTS, stated plainly: an instance cannot be cut down, and
 * `physicality.mjs` skips InstancedMesh precisely because a batch has no
 * individual identity. So every column still gets a REAL COLLIDER — one static
 * box each, because a column you walk through is worse than a column you
 * cannot cut — and everything in this hall at arm's reach (benches, braziers,
 * statues, fallen drums) is placed one at a time and is solid, cuttable and
 * liftable. What you can cut is what you can stand next to.
 *
 * @returns the number of columns standing.
 */
export function templeColonnade(world, opts = {}) {
  const M = propMaterials();
  const T = world.terrain;
  const ranks = opts.ranks || [];
  const z0 = opts.z0 ?? -140, z1 = opts.z1 ?? 140;
  const r2 = makeRng(opts.seed ?? 7700);

  /* THE SHAFT, as a unit column: radius 1 at the foot, 0.88 at the neck, one
   * metre tall, standing on y = 0. 14 height segments is not detail — it is
   * the resolution the helical band needs to stay a smooth ribbon rather than
   * a zigzag, and it was arrived at by halving until the band broke. */
  const shaft = tubeUv(new THREE.CylinderGeometry(0.88, 1.0, 1.0, 12, 14, true), TAU, 1.0, 2.4);
  shaft.translate(0, 0.5, 0);
  /* The band, painted. `temple after battle` wraps every column in a dark
   * ribbon with a pale edge, climbing about one turn in three column heights,
   * and it is the detail that stops a cylinder reading as a pipe: it gives the
   * eye a line that goes AROUND, so the column reads as round and as tall at
   * the same time. Also twenty-four shallow flutes, at a quarter of the band's
   * contrast, because a column with only one feature on it is a decal. */
  paintGeo(shaft, (x, y, z, out) => {
    const a = Math.atan2(z, x) / TAU + 0.5;                 // 0..1 round
    const helix = Math.abs(((a - y * 3.0) % 1 + 1) % 1 - 0.5) * 2;   // 1 on the band
    const band = smoothstep01(0.86, 0.94, helix);
    const edge = smoothstep01(0.74, 0.86, helix) * (1 - band);
    const flute = 0.5 + 0.5 * Math.cos(a * TAU * 24);
    const k = 1 - band * 0.62 + edge * 0.24 - flute * 0.05;
    out[0] = k; out[1] = k * 0.995; out[2] = k * 0.985;
  });

  /* The base: a stepped drum with an astragal over it, and the capital: the
   * same profile inverted with an abacus on top. Both are built at the
   * column's own radius so one uniform scale places them. */
  const base = mergeGeos([
    tubeUv(new THREE.CylinderGeometry(1.30, 1.46, 0.36, 12, 1, false), TAU * 1.46, 0.36, 2.4)
      .translate(0, 0.18, 0),
    tubeUv(new THREE.CylinderGeometry(1.06, 1.30, 0.40, 12, 1, false), TAU * 1.30, 0.40, 2.4)
      .translate(0, 0.56, 0),
    torusGeo(1.02, 0.10, 6, 12, TAU, 1.2).rotateX(Math.PI / 2).translate(0, 0.80, 0),
  ]);
  const cap = mergeGeos([
    torusGeo(0.94, 0.11, 6, 12, TAU, 1.2).rotateX(Math.PI / 2).translate(0, -0.10, 0),
    tubeUv(new THREE.CylinderGeometry(1.34, 0.94, 0.62, 12, 1, false), TAU * 1.34, 0.62, 2.4)
      .translate(0, 0.31, 0),
    slabGeo(2.90, 0.34, 2.90, { tile: 2.4, seg: 2 }).translate(0, 0.79, 0),
  ]);
  const beam = slabGeo(1, 1, 1, { tile: 2.4, seg: 2 });

  const shafts = [], bases = [], caps = [], beams = [], tints = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  /* THE TWO FAMILIES. Warm bronze and cool pale ashlar, alternating along each
   * rank and offset between ranks so no two neighbours in ANY direction match —
   * which is what the reference actually shows and what a plain ABAB stripe
   * does not: laid out in a grid, ABAB reads as two solid walls of colour. */
  const BRONZE = new THREE.Color(1.00, 0.70, 0.40);
  const PALE = new THREE.Color(0.94, 0.92, 0.87);
  let n = 0;
  for (let k = 0; k < ranks.length; k++) {
    const R = ranks[k];
    const count = Math.max(2, Math.floor((z1 - z0) / R.pitch));
    for (let i = 0; i <= count; i++) {
      const z = z0 + i * R.pitch;
      for (const sx of [-1, 1]) {
        const x = sx * R.x;
        if (!T.inBounds(x, z, 4)) continue;
        // …and nothing stands inside a room the level has cut out of the aisle
        if (opts.holes && opts.holes.some((h) =>
          (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r)) continue;
        const y = T.height(x, z);
        const h = R.h * (0.97 + r2() * 0.06);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r2() * TAU);
        shafts.push(m.clone().compose(p.set(x, y, z), q, s.set(R.r, h, R.r)));
        bases.push(m.clone().compose(p.set(x, y, z), q, s.setScalar(R.r)));
        /* THE CAPITAL IS SUNK 0.55 OF A RADIUS INTO THE SHAFT TOP, and that is
         * not a fudge — `prop-seating.mjs` asks whether every assembly is
         * standing on something, and its test for "carried" is that the
         * supporter's top reaches the supported thing's MIDDLE. Placed flush on
         * the shaft's end the capital's middle was 0.54 r above it and 62 of
         * them read as floating in mid-air. A capital's necking overlapping the
         * shaft it caps is also what masonry does. */
        caps.push(m.clone().compose(p.set(x, y + h - R.r * 0.55, z), q, s.setScalar(R.r)));
        tints.push(((i + k * 3 + (sx > 0 ? 1 : 0)) % 3 === 0 ? BRONZE : PALE));
        /* ONE STATIC BOX PER COLUMN — you may not cut it, and you may not walk
         * through it either — BUT ONLY NINE METRES OF IT.
         *
         * The cap is the same one `Trees.js` puts on a standing trunk and it is
         * there for the same measured reason: every near-list in this engine
         * (Player._gatherNear, Enemy's push-out, `supportHeight`, `spawnClear`)
         * walks `physics.staticBoxes` LINEARLY, once per body per frame, and
         * rejects on `box.radius`. A 31 m column boxed to its full height has a
         * radius of 15.6 m, so every one of 228 columns is a near-neighbour of
         * anything within fifteen metres of it — on the Temple that took the
         * nav walk in `levels-quality` from seventy seconds to over twenty
         * minutes at 99% CPU, which is what found it.
         *
         * Nothing in this game stands above 9 m without leaving the ground and
         * a double Force jump tops out at 6.18 m, so the boxed part is the part
         * anyone can meet; the cap takes the radius to 4.9 m and the test
         * volume to a tenth. It is a collider, not a silhouette — the column is
         * still drawn to its full height. */
        const bh = Math.min(9, h);
        world.physics.addStaticBox(new THREE.Vector3(x, y + bh * 0.5, z),
          new THREE.Vector3(R.r, bh * 0.5, R.r), new THREE.Quaternion(), { friction: 0.9 });
        // the beam onward to the next column of this rank
        if (i < count) {
          /* The architrave rests IN the capitals it spans, for the same reason
           * the capital is sunk into the shaft: 0.9 m deep and bedded 0.5 m
           * below the abacus, so its middle is under the thing carrying it and
           * `prop-seating` can see what is holding it up. A beam floating over
           * a gap between two columns is what a lintel must never look like. */
          const zm = z + R.pitch * 0.5;
          const capTop = y + h - R.r * 0.55 + R.r * 1.38;
          beams.push(m.clone().compose(p.set(x, capTop - 1.5, zm), new THREE.Quaternion(),
            s.set(R.r * 2.3, 2.2, R.pitch + 0.4)));
        }
        n++;
      }
    }
  }
  addInstanced(world, shaft, M.sandstone, shafts, new THREE.Vector3(),
    { name: 'templeShaft', colors: tints });
  addInstanced(world, base, M.duracreteWarm, bases, new THREE.Vector3(), { name: 'templeBase' });
  addInstanced(world, cap, M.duracreteWarm, caps, new THREE.Vector3(), { name: 'templeCap' });
  addInstanced(world, beam, M.sandstone, beams, new THREE.Vector3(),
    { name: 'templeArchitrave', castShadow: false });
  return n;
}

/** The smoothstep the painters above want, without dragging in a module. */
function smoothstep01(a, b, v) {
  const t = clamp((v - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export const LEVELS = {
  /* ══════════════════════════════════════════════════════════════════════
   *  THE OPEN GROUNDS
   *
   *  "another map of just endless sand dunes that you deform with sand
   *   storms, and another in a blizzard/mountain."
   *
   *  There was a third — the meadow — and it is deleted. It is worth one
   *  sentence because the reason generalises: every other surface in this
   *  game is drawn by the cel pipeline and the meadow's ground was not, so
   *  it read as a different game stitched into this one. A surface that
   *  breaks the art direction is worse than an absent surface, and the
   *  correct response to "the grass looks like a PBR leftover" is to stop
   *  shipping it rather than to tune it a fourth time.
   *
   *  Two things about "endless" are worth writing down once, here, because
   *  both of these levels live or die on them.
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
   *  gorgeous and is the opposite of hidden. A level that wants the ranges
   *  BURIED needs tall fog instead.
   * ═════════════════════════════════════════════════════════════════════ */

  drifts: {
    name: 'The Shifting Waste',
    blurb: 'Dunes twice the height of the sea, and a storm that comes for you every ninety seconds.',
    terrain: 'drifts',
    /* `bodyguard` is here to open the SET-PIECE door and for no other reason —
     * see its registration at the bottom of this file. A boss archetype is
     * filtered out of ordinary fill by `unlockedAt`, so one entry in a pool of
     * nine is a key, not a weight. */
    pool: ['b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker', 'bodyguard'],
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
      /* WHAT THE WRECKS SPILLED. `strewWrecks` builds the hull frames, which
       * are scenery with colliders; these are the loose objects that go with
       * them — the things you can cut, lift and throw. `sliceable.mjs` counts
       * exactly that per level and this one offered ONE, which is a level you
       * can only fight people on. */
      for (let k = 0; k < 8; k++) {
        const site = findSite(world, 20, 116, { clearance: 6, maxSlope: 0.32, tries: 18 });
        if (site) addCrateStack(world, site.pos, { count: 2 + (rng() * 4 | 0), seed: 8840 + k });
      }
      for (let k = 0; k < 12; k++) {
        const site = findSite(world, 12, 122, { clearance: 3, maxSlope: 0.36, tries: 14 });
        if (!site) continue;
        if (rng() < 0.38) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.82);
      }
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
      /* ── NINE MASSIFS, AND NOT ONE STONE. See `strewSnowForms` above for the
       * whole argument and the reference it comes off. What stood here was
       * fourteen `addOutcrop` crags plus a three-grade `strewGround` stone
       * field at 1.6/1.4/1.3 — the heaviest litter on the roster, on the one
       * level whose reference plate contains no rock at all.
       *
       * The pass before this one re-tinted that field and wrote down that
       * "the counts are untouched, and that is deliberate… the complaint is
       * that the stones are BROWN, not that there are too many". That was
       * wrong, and the second telling says so: "i already told you to get rid
       * of the rocks in the white pass but they're still there it feels like a
       * reskin of the dunes map." It was a reskin of the dunes map. The shapes
       * were the dune sea's shapes in the dune sea's places.
       *
       * Nine massifs and not fourteen crags, because a massif is much bigger
       * than a crag was and because the reference's mid-ground holds exactly
       * one. They are the only furniture on this level with a collider. */
      for (let k = 0; k < 9; k++) {
        const site = findSite(world, 22, 104, { angle: (k / 9) * TAU + rng() * 0.7, clearance: 17, maxSlope: 0.36 });
        if (!site) continue;
        addSnowMassif(world, site.pos, { size: 5.5 + rng() * 6, height: 4 + rng() * 5,
          seed: 700 + k, yaw: rng() * TAU });
      }
      /* THE GROUND ITSELF. Sastrugi combed along the level's own wind bearing,
       * and drift humps in clumps where the field says the wind is already
       * piling. Nothing here is a collider and nothing is over a metre high: a
       * snowfield you trip on is a snowfield you cannot fight in. */
      strewSnowForms(world, { seed: 9932, radius: 148, spread: 0.52 });

      /**
       * AND SOMETHING TO CUT, because the stone field was carrying that too.
       *
       * Taking the rocks out took the level's whole loose-object population
       * with them — `sliceable.mjs` counts how many levels have enough
       * reachable objects for "props are cuttable" to be a claim about the
       * game, and this one fell to nothing. A cirque with no stone in it is
       * right; a cirque with nothing in it at all is a plate.
       *
       * What belongs above the treeline is what somebody LEFT there, and it is
       * also what the level's own fiction wants: this is a pass, so it is a
       * route, so there is wreckage on it. Hulls half drifted over, a supply
       * cache somebody dug in and abandoned, and the crates out of it. All of
       * it stands clear of the snow, which is the other thing the level needed
       * — `world-immersion` measures how much walkable ground has nothing with
       * a silhouette in view of it.
       */
      strewWrecks(world, { count: 5, rmin: 34, rmax: 128, maxSlope: 0.34, seed: 9940 });
      for (let k = 0; k < 7; k++) {
        const site = findSite(world, 18, 118, { clearance: 6, maxSlope: 0.30, tries: 18 });
        if (!site) continue;
        addCrateStack(world, site.pos, { count: 2 + (rng() * 4 | 0), seed: 9950 + k });
      }
      for (let k = 0; k < 10; k++) {
        const site = findSite(world, 12, 130, { clearance: 3, maxSlope: 0.34, tries: 14 });
        if (!site) continue;
        if (rng() < 0.4) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.8);
      }
      return 11;
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

  scoria: {
    name: 'The Ember Shelf',
    blurb: 'A basalt shelf standing out of a lava sea, under an ash fall. Nothing here is neutral ground.',
    terrain: 'scoria',
    // A duelling map wants blades in it. The pool is weighted to the one
    // sabered archetype this game has and thinned of hordes: half of what
    // walks out of the ash is something that will meet your guard.
    /**
     * THE FOUR JEDI ARCHETYPES LIVE HERE NOW, and the reason is that they had
     * to live somewhere.
     *
     * `jedi`, `sentinel`, `guardian` and `master` were built, priced, given
     * silhouettes, hilts, crystals and duel forms for the Temple Halls, and the
     * Temple Halls is deleted. An archetype no pool names is unreachable —
     * `unlockedAt` filters the ladder by `pool.includes` and `_setPiece` filters
     * by it too — so deleting that level would have deleted four bodies with it,
     * silently, which is exactly the failure tools/checks/roster.mjs exists to
     * catch. It caught it.
     *
     * This level rather than another because it is the game's DUELLING map and
     * says so at length above: a shelf with a clear middle to circle in and
     * cover only at the edges. Four blades that feint, chamber and riposte want
     * that shape; they would be four health bars in a foundry corridor.
     *
     * `master` keeps `setPieceOnly: true`, so it is still only ever a boss —
     * naming it here opens the set-piece door, not the fill.
     */
    pool: ['acolyte', 'acolyte', 'b2', 'droideka', 'acolyte', 'trooper', 'b1', 'sniper',
      'jedi', 'sentinel', 'guardian', 'master'],
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
    /* AND IT BURNS. 52 HP a second, which kills an unarmoured 100 HP jedi in
     * 1.9 s — long enough that stepping a foot in at the shore and stepping
     * back out costs a quarter of your health and teaches the lesson, short
     * enough that walking into the sea is a death and not a swim. Before this
     * number existed a player could hold forward for 90 s and finish 33 m under
     * the surface at 100/100, which is what made the whole 69% of this map that
     * is lava into floor. See src/world/Hazard.js. */
    water: { level: 0.55, damage: 52, kind: 'lava',
             shallow: 0xff8a1e, deep: 0x76140a, sky: 0xdc4206, bed: 0x140d10 },
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
       * dome and is blue. On the Ember Shelf the brightest thing that is not the sun
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
       * long way and it is the level's roof: what is over the Ember Shelf is not
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
        if (site) if (rng() < 0.34) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.85);
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 26, 62, { clearance: 6, maxSlope: 0.22, minHeight: sea + 1.0 });
        if (site) addCrateStack(world, site.pos, { seed: 7600 + k, tiers: 2 + (rng() < 0.4 ? 1 : 0) });
      }
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
   *  MUSTAFAR — the real one
   *
   *  "For the actual mustafar map go off the reference images more."
   *
   *  THE EMBER SHELF ABOVE IS NOT THIS AND IS NOT BEING REPLACED BY IT. It was
   *  called Mustafar, the player renamed it, and it stays as its own place: a
   *  basalt shelf in an open molten sea, dressed for duelling. What the
   *  references show is a different planet-scale idea and the two can stand
   *  beside each other because their LANDFORMS are opposites — see the
   *  `mustafar` preset in Terrain.js, which derives both from the same water
   *  plane approached from different sides.
   *
   *  WHAT THE REFERENCES ACTUALLY SHOW, amalgamated over all five:
   *
   *    RIVERS, NOT A SEA. In every frame the melt is a braided channel system
   *    winding through rock — a trunk with strands splitting and rejoining
   *    round bars, falls pouring over ledges, and a web of thin veins cracking
   *    the crust between them. `mustafar 4` is nothing but that.
   *    DARK ROCK. The basalt is a near-black grey-brown everywhere; it only
   *    reads red where the melt is lighting it. Author it warm and there is
   *    nothing for the accent to be an accent against.
   *    LIGHT FROM BELOW. Every rock face in `mustafar 4` and `6` is lit from
   *    underneath by the channel at its foot, and every silhouette in the frame
   *    is a rim-lit edge over an orange floor. That is not a post effect here,
   *    it is thirty point lights strung ALONG THE CHANNELS at −0.4 m, which is
   *    the one lighting decision this level is built on.
   *    SMOKE COLUMNS. Vertical, from vents, standing still in the frame while
   *    everything else moves.
   *    INDUSTRY. The collection platforms — a disc canopy on a stem, several of
   *    them at different heights over the flows — and one larger works with
   *    radiator fins and towers, `mustafar 5`/`6`.
   *
   *  IT IS A HORDE MAP AND THE SHELF IS A DUELLING MAP, which is the other
   *  reason both can exist: this ground is broken into shelves separated by
   *  rivers you cannot cross except where the rock allows, so the fight is
   *  about WHERE and the Ember Shelf's is about WHEN.
   * ═════════════════════════════════════════════════════════════════════ */

  mustafar: {
    name: 'Mustafar',
    blurb: 'Rivers of melt braided through black rock, under a sky the colour of a wound. The ground is lit from below.',
    terrain: 'mustafar',
    pool: ['b1', 'trooper', 'b2', 'acolyte', 'droideka', 'b1', 'sniper', 'acolyte', 'walker'],
    groundColor: 0x2b2622,
    spawnRadius: [30, 54],
    /* THE MELT, at the datum, and the channels are cut 5.2 m into a shelf that
     * stands 3.1 m over it — so the sheet is only ever visible IN the cuts,
     * which is the whole difference between this and a lava sea. 56 HP a
     * second: between the Ember Shelf's 52 (a shore you brush) and the
     * foundry's 58 (a slot you are in), because a river is both. */
    water: { level: 0.0, damage: 56, kind: 'lava',
             shallow: 0xffa32a, deep: 0x7e1806, sky: 0xe4550a, bed: 0x160c0c },
    atmosphere: {
      /* The same smoke sky the Ember Shelf derives, and its long note about
       * `rayleigh` applies verbatim: below about 1.6 the physical model returns
       * so little radiance that the exposure meter hits its clamp and the frame
       * stops being exposed by its own light, which took four checks down with
       * it. 1.8 keeps the model in range and the RED comes from the sun colour,
       * the cloud deck and the grade. */
      turbidity: 9.0, rayleigh: 1.8, mie: 0.013, mieG: 0.85,
      /* The trunk river runs roughly along +x. A sun at 148° crosses it, so
       * every levee and every bar has a lit face and a shaded one — the same
       * rule the dune train and the flow lobes derive. 148 and not 328 for the
       * reason the Ember Shelf's block records at length: the default pose
       * looks down −z, and a bearing in the darkest quarter of the dome puts
       * the sky the player is looking at DARKER than the air in front of it.
       *
       * 17°, NOT THE 13° FIRST WRITTEN, and the number was decided by a check
       * rather than by taste. `cel.mjs` holds two properties about a shadow at
       * once: at least 30% of a shaded surface's light must still come from the
       * KEY (or the shade takes the ambient's hue and stops being the surface),
       * AND the key's share has to rise with sun height across the whole
       * roster, strictly wherever two levels differ by more than 10% of sun
       * height. At 13° this level sat below the Ember Shelf's 15° by 15%, so it
       * had to come in UNDER the Ember Shelf's 30.1% — and under the 30% floor,
       * which is the same number. There is no pair of key and ambient that
       * satisfies both; the elevation is what was wrong.
       *
       * 19.5 AND NOT 17 OR 18, and the last move was forced by GEONOSIS
       * arriving in the roster at 21°. The rule is strict wherever two levels
       * differ by more than 10% of sun height, and at 18° this level was
       * squeezed between Kamino below it (36.4%) and Geonosis above it (36.7%)
       * — a window three tenths of a point wide, which is not a design, it is a
       * coincidence waiting to break. At 19.5 the nearest levels in sun height
       * are the Drowned Wood at 19 and Geonosis at 21, both inside the 10%
       * band, so nothing is strict against them and the window is Kamino's
       * 36.4% to the dune sea's 41.4%. It is still one of the lowest suns in
       * the game and a smoke ceiling this thick is what makes the level dark,
       * not the elevation. */
      /* 132°, not 148: the bearing IS the knob for aerial convergence (see the
       * fog note below), and swinging it 16° toward the view axis more than
       * halved the overshoot before the density finished the job. */
      elevation: 19.5, azimuth: 132,
      /* 4.7 OVER 0.82, NOT 4.2 OVER 0.86. `cel.mjs` holds every level's shaded
       * ground to keeping at least 30% of its light from the KEY — the whole
       * reason a shadow on this project is a deeper version of the surface
       * rather than a blue hole in it — and at the first pair it measured 29%.
       * A smoke sky wants a big hemisphere term (see the Ember Shelf's note on
       * why: a two-band cel ramp with a 13° sun puts most of the ground in the
       * shaded band and a cold probe bands it to lavender), but the hemisphere
       * cannot be so much of the budget that the shade forgets which way the
       * sun is. */
      /* 7.2 OVER 0.56, AND THE PAIR WAS SOLVED RATHER THAN CHOSEN. `cel.mjs`
       * requires the key's share of a shaded surface's light to RISE with sun
       * height across the whole roster, and it is the only knob that moves it:
       * measured on this level's own atmosphere, rayleigh 1.8→3.0 and turbidity
       * 9.0→6.2 move the share by 0.0 points, because `envI` scales with
       * `direct` and the two terms travel together. Only the key-to-ambient
       * ratio moves it, and it moves it slowly — at this elevation 5.4/0.72
       * gives 36.5% and 9.6/0.42 gives 40.8%. This pair gives 38.5%, in the
       * middle of the window Kamino's 36.4% and the dune sea's 41.4% leave.
       *
       * The Ember Shelf's block argues at length for a very large hemisphere
       * term on a level like this, and it is still mostly right — a two-band
       * cel ramp with a low sun puts most of the ground in the shaded band, and
       * a cold probe bands it to lavender. What this pair says is that there is
       * a ceiling on that: past about 0.6 of ambient the shade stops knowing
       * which way the sun is. The warm `fillColor` below carries what the
       * hemisphere gives up. */
      sunColor: 0xff8a48, sunIntensity: 7.2, ambient: 0.56,
      skyColor: 0xc85428,
      /* The hemisphere's lower half is the ASH, not the basalt — the Ember
       * Shelf's block records why: this is the colour of the light the ground
       * throws back UP, and what is lying on this ground is a pale ash fall.
       * Authored as the 0.03-luminance rock, the cloud deck over an ash plain
       * ends up lit entirely by itself. */
      groundColor: 0x4a413a,
      /* THE FILL IS THE RIVER. Everywhere else in this game the brightest thing
       * that is not the sun is the sky; here it is the melt in the channels and
       * the smoke ceiling is lit from below by it. Warmer and stronger than the
       * Ember Shelf's because a river 26 m across at your feet throws more at
       * you than a sea 100 m away. */
      fillColor: 0xd2601e, fillIntensity: 0.86,
      /* Smoke. Half-light at 96 m, which still hides the edge of a 500 m field
       * on a level whose skyline is its own volcano wall.
       *
       * 0.0072 AND NOT THE 0.0102 FIRST WRITTEN, and the reason is a crossing
       * rather than a visibility. `terrain-aerial` requires the ground to walk
       * ONTO its own sky in chromaticity and keep walking; this ground is a
       * near-neutral charcoal and this sky is a saturated orange, so the walk
       * is long and mostly in one direction — and at 0.0102 it ARRIVED at 60 m
       * and then overshot, coming back out the far side (0.021 → 0.073) as the
       * mixing target slid from the near air onto the sky. Thinner air makes
       * the same journey take until 200 m and it lands rather than passing
       * through. The near air's SWATCH is not the knob here and that was
       * measured: three fog colours from 0x5c2c1e to 0x584038 moved the
       * crossing by 0.004, exactly as Kamino's own note predicts —
       * `hazeRadiance` takes the near air's LEVEL from the sky model and only
       * its tint from `fogColor`, so the bearing and the density are the knobs
       * and the swatch is not. */
      fogColor: 0x584038, fogDensity: 0.0072, fogHeight: 40, fogBase: 4,
      /* Authored rather than derived, for the reason the Ember Shelf's block
       * gives: on a sky this compressed the sunward and side skyline samples
       * land within a per cent of each other, the default estimate comes out at
       * zero and the forward-scatter glow switches off entirely — on the one
       * kind of sky where mie scatter is strongest. */
      inscatter: 0.034,
      /**
       * BLOOM 0.42, DOWN FROM 0.56 — the roster's highest, and it was buying
       * nothing.
       *
       * A lava planet invites a hot bloom and this had the hottest on the
       * roster. `saber-bloom` measured what it actually bought: at 0.56 the
       * pass runs at 0.403 effective, and **past 0.30 the blown-white run
       * along the blade has already flattened onto the bloom-off floor**. Every
       * point above that is cost with no image change — on the level that also
       * carries 26 point lights along its channels.
       *
       * It is also the wrong direction for player note #40, "there is too much
       * bloom on the lightsaber in first person". 0.42 sits between the temple's
       * 0.40 and scoria's 0.50, which is where a level lit from below belongs
       * relative to the other two that are.
       */
      exposure: 0.94, bloom: 0.42, saturation: 1.12,
      gain: [1.15, 0.99, 0.72],
      // Warm blacks: on this level the shadows are lit by the floor.
      lift: [0.018, 0.005, 0.002],
      /* A ceiling of smoke, not a deck of cloud, lit from BELOW — so the lit
       * swatch is the river's colour and the dark swatch is very dark. */
      cloudCover: 0.92, cloudLit: 0xff7a26, cloudDark: 0x2a1512,
      cloudWindDir: 0.68, cloudWindSpeed: 1.6,
      horizonColor: 0x6e2f12,
      /* NO PAINTED RANGES. The heightfield's own rim climbs 54 m from 150 to
       * 244 out and the dressing pass stands cones and smoke columns on it; a
       * painted curtain at 340 m would sit in front of the only silhouette this
       * level is actually about. */
      horizon: false,
    },
    ambience: { wind: 0.18, windFreq: 170, drone: 0.30 },
    dust: {
      count: 1600, color: 0x8a7268, opacity: 0.30, size: 26,
      // Embers off the rivers. The only warm thing in the air and the only
      // place on this level where the accent is small and everywhere at once.
      fleckColor: 0xff9a2e,
      wind: { from: 148, strength: 2.8, gustiness: 0.60, wander: 0.38 },
      // Ash fall — mechanically the blizzard with dark, slow, heavy flakes in
      // it, which is what the Ember Shelf established and what ash is.
      snow: { count: 5400, calm: 0.38, color: 0x6a615c, fall: 0.46, size: 0.17 },
      // A surge off the river: the air thickens, the light goes, the wind
      // barely moves. Heat and smoke, not grit.
      weather: { peak: 0.90, period: 116, duration: 42, unrest: 0.19,
                 fogGain: 2.4, windGain: 1.6, sunLoss: 0.78, fillGain: 1.6, tint: 0.95 },
    },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 109);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);
      const melt = world.level?.water?.level ?? 0;

      /* ── THE LIGHT OFF THE RIVERS, and it is this level's whole lighting
       * scheme rather than a decoration. Every reference frame is lit from
       * BELOW: the rock faces are orange at the foot and black at the crest,
       * and every silhouette in the frame is a rim-lit edge over a glowing
       * floor. The sheet's own shader is analytic and self-luminous (see the
       * Ember Shelf's note) so the melt DRAWS bright with no key on it — but it
       * throws nothing on the rock, and the rock is most of the frame.
       *
       * So the channels are walked and lit. `walkChannel` steps along the
       * heightfield looking for ground under the melt line, which means the
       * lamps land where the river ACTUALLY is rather than where a hand-typed
       * table of waypoints says it is — the same rule as Kamino's deck table
       * and for the same reason (HANDOFF §2.3).
       *
       * 26 lights, not 60. `lighting.mjs` and the frame budget both care, and
       * measured on the built level 26 at 42 m of range covers 84% of the
       * channel network's length; the rest is inside another lamp's falloff. */
      {
        let lit = 0;
        for (let k = 0; k < 240 && lit < 26; k++) {
          const a = rng() * TAU, r = 18 + Math.sqrt(rng()) * 130;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (!T.inBounds(x, z, 6)) continue;
          if (T.height(x, z) > melt - 1.2) continue;          // not in the melt
          let clear = true;
          for (const q of (world._lavaLights || [])) {
            if ((q.x - x) ** 2 + (q.z - z) ** 2 < 34 * 34) { clear = false; break; }
          }
          if (!clear) continue;
          (world._lavaLights || (world._lavaLights = [])).push({ x, z });
          const L = new THREE.PointLight(0xff6a14, 26, 42, 2);
          L.position.set(x, melt - 0.4, z);
          world.scene.add(L); world.levelLights.push(L);
          lit++;
        }
      }

      /* ── THE ROCK. Sharp stacks and spires standing over the channels — the
       * reference's crests are knife-edged and every one of them is a
       * silhouette against a lit river. Kept off the melt (`minHeight`) so
       * nothing stands in the water, and pushed out of the middle so the shelf
       * you spawn on is fightable. */
      for (let k = 0; k < 22; k++) {
        const site = findSite(world, 22, 132, {
          angle: (k / 8) * TAU + rng() * 0.7, clearance: 12, maxSlope: 0.40,
          minHeight: melt + 2.0,
        });
        if (!site) continue;
        addOutcrop(world, site.pos, {
          size: 3.4 + rng() * 5.0, height: 8 + rng() * 13, seed: 9400 + k, mat: M.stoneDark,
        });
      }
      // and the far cones on the rim, which are what the skyline is made of
      for (let k = 0; k < 11; k++) {
        const site = findSite(world, 140, 226, { clearance: 20, maxSlope: 0.62, tries: 26 });
        if (site) addOutcrop(world, site.pos, { size: 9 + rng() * 8, height: 20 + rng() * 22, seed: 9440 + k, mat: M.stoneDark });
      }

      /* ── THE SMOKE COLUMNS. Vertical, from vents on the high ground — the one
       * thing in `mustafar 3` that stands still while the sky moves. Built as
       * tall dark tapered stacks rather than particles: at this level's air a
       * particle column 120 m out is gone, and what the reference shows is a
       * SHAPE with an edge on it. */
      for (let k = 0; k < 7; k++) {
        const a = 0.4 + k * 0.92, d = 96 + (k % 3) * 44;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!T.inBounds(x, z, 8)) continue;
        island(world, at(x, z), { seed: 9500 + k, yaw: rng() * TAU, span: 14,
          maker: 'vent', destructible: 'stone' },
          (kit) => {
            // the vent it comes out of
            kit.post(M.stoneDark, 4.6, 3.2, 3.0, 0, 1.5, 0, { radial: 9, tile: 2.4, collide: true });
            kit.slab(M.glowRed, 4.0, 0.4, 4.0, 0, 3.1, 0, { tile: 1.6, seg: 3, collide: false });
            // and the column over it, leaning downwind, thinning as it climbs
            let y = 3.4, r = 2.6, lean = 0;
            for (let s = 0; s < 7; s++) {
              const h = 5.0 + s * 1.4;
              lean += 0.5 + s * 0.28;
              kit.post(M.stoneDark, r * 0.82, r, h, lean * 0.5, y + h * 0.5, lean * 0.32,
                { radial: 7, tile: 2.4, collide: false });
              y += h; r *= 0.86;
            }
          });
      }

      /* ── THE COLLECTION PLATFORMS. `mustafar 5` and `6`: a disc canopy on a
       * stem, several of them at different heights over the flows, with the
       * mining works itself a larger cluster of fins and towers. They are the
       * only built things on this planet and they are what says somebody is
       * here for the ore. Three, well apart, on the shelf. */
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 34, 96, {
          angle: 0.9 + k * 2.1, clearance: 20, maxSlope: 0.20, minHeight: melt + 2.6, tries: 28,
        });
        if (!site) continue;
        island(world, site.pos, { seed: 9600 + k, yaw: rng() * TAU, span: 17,
          maker: 'collector', destructible: 'durasteel' },
          (kit, local) => {
            // the stem, and the canopy over it — the silhouette of the whole
            // planet's industry in two shapes
            kit.post(M.rust, 1.5, 1.9, 9.0, 0, 4.5, 0, { radial: 10, tile: 2.4, collide: true });
            kit.post(M.darkSteel, 6.6, 1.6, 1.4, 0, 9.7, 0, { radial: 14, tile: 2.4, collide: true });
            kit.slab(M.rust, 12.0, 0.35, 12.0, 0, 10.5, 0, { tile: 2.4, seg: 4, collide: false });
            // the plant round its foot
            addTank(world, local(-5.0, 1.2), { kit, radius: 2.0, height: 6.4, seed: 9610 + k });
            addMachine(world, local(4.4, -2.2), { kit, width: 4.0, height: 2.8, depth: 2.4,
              seed: 9620 + k, glowMat: M.glowRed });
            addPipeRun(world, [
              new THREE.Vector3(-5.0, 6.6, 1.2), new THREE.Vector3(-1.0, 6.0, 0.4),
              new THREE.Vector3(4.4, 3.6, -2.2),
            ], { kit, count: 2, radius: 0.13, seed: 9630 + k });
            addStanchion(world, local(1.6, 4.6), { kit, height: 6.0, lamp: true, light: k === 0,
              color: 0xffb46a, intensity: 14, distance: 24, seed: 9640 + k });
          });
        addDebrisField(world, site.pos, { radius: 11, seed: 9650 + k, count: 24 });
      }

      /* ── THE ORE TRAINS THAT DID NOT MAKE IT, half sunk in the clinker: the
       * mid-distance silhouette band and the cover you actually fight behind. */
      strewWrecks(world, { count: 5, rmin: 36, rmax: 150, seed: 9700, maxSlope: 0.36 });
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 32, 118, { clearance: 13, maxSlope: 0.32, minHeight: melt + 1.6 });
        if (site) addHullSection(world, site.pos, { length: 14 + rng() * 9, radius: 3.0, yaw: rng() * TAU, seed: 9720 + k });
      }

      /* ── THE BROKEN FLOW FRONT along the channel edges: where a lobe stopped
       * it left a wall of clinker, and that is the cover at the lip of every
       * river on this map. */
      for (let k = 0; k < 12; k++) {
        const site = findSite(world, 20, 122, { clearance: 8, maxSlope: 0.58, minHeight: melt + 0.6 });
        if (site) addBoulderCluster(world, site.pos, { radius: 8, count: 14, size: 1.7, seed: 9760 + k, mat: M.stoneDark });
      }

      // ── The clinker itself. Heavier than a desert because a flow front sheds
      // more, and this level's ground cover is the ash the preset lays down.
      strewGround(world, { seed: 9800, radius: 150, spread: 0.36, mat: M.stoneDark,
        landmarks: 1.3, boulders: 1.4, cobble: 1.5 });

      // ── What a working face has lying on it.
      for (let i = 0; i < 12; i++) {
        const site = findSite(world, 22, 92, { clearance: 4.0, maxSlope: 0.26, minHeight: melt + 1.4 });
        if (site) if (rng() < 0.36) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.85);
      }
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 28, 88, { clearance: 6, maxSlope: 0.22, minHeight: melt + 1.6 });
        if (site) addCrateStack(world, site.pos, { seed: 9840 + k, tiers: 2 + (rng() < 0.4 ? 1 : 0) });
      }

      world.notify('MUSTAFAR', 'the rivers are not fords');
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
   *  THE CREATURES are five archetypes, registered at the bottom of this file
   *  beside the warship's general. They are `boss: false` and carry `unlockAt`,
   *  so unlike a set-piece they arrive as the WAVE — which is what "a wave of
   *  creatures" means — and `heavyLimit` bounds how many are on the sand at
   *  once. What makes each a different fight is written out where they are
   *  declared, and it is now two things rather than one: `_beastBrain` gates
   *  its move set on the fraction of health remaining, so a 420 hp animal
   *  reaches its charge phase in seconds and a 1,250 hp one spends the whole
   *  fight in its first — AND the move set itself is the archetype's, so the
   *  brute's slam and the pouncer's leap need answers that no claw in the game
   *  needs. Three creatures was three health bars over one move set; five is
   *  three different verbs.
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
    pool: ['charger', 'stalker', 'brute', 'b1', 'beast', 'pouncer', 'b2', 'stalker', 'droideka', 'sniper'],
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
      /* NO PAINTED RANGES. The bowl's own arcade stands 54 m over the floor at
       * a radius of 120, which subtends 24° — so a painted curtain at 340 m
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
      /* FIVE SPECIES IN THE HOUSE. "Make them either alien species or mixes of
       * aliens" — see the head table in `addCrowd`, which is where the five
       * profiles and the reason each one exists are written down. Four extra
       * draw calls on a level that spends 167. */
      addCrowd(world, V(0, 0, 0), {
        seed: 6300, rows: 20, rmin: 72, rmax: 118, rise: 1.62, y0: 6.2,
        aspect: 0.74, gaps, fill: 0.86, pitch: 1.2, stride: 240, excite: 1,
        variants: 5,
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
   *    THE COUNT.   1,800 trees, and the number is derived where it is set —
   *                 see the note over `count` in the dressing pass, which is
   *                 the only place in this file that may state it. A wood is a
   *                 thing you cannot see through, and what decides that is
   *                 stems per hectare rather than any amount of fog: measured
   *                 on the planted stand, the median sight line on the walkable
   *                 ground is 14 m and the ninetieth percentile 63, against
   *                 208 m in the arena.
   *
   *                 THIS BLOCK SAID 520 AND A 21 m SIGHT LINE, three times, for
   *                 as long as the level has existed — while two hundred lines
   *                 below it the pass planted 1,800 and recorded that at 520
   *                 the median measured 110 m, "which is not a wood, it is a
   *                 park with trees in it". A maintainer reads the header
   *                 first, so the header was the one place the level lied
   *                 about the only number it is designed around, by 3.5×.
   *    THE DENSITY DISTRIBUTION. Not uniform. `drift` places them through a
   *                 cover field, so the wood has thickets you cannot fight in
   *                 and glades you can — and a glade you arrived at is worth
   *                 more than a glade that was always there, which is what
   *                 felling is for.
   *
   *  AND IT COSTS THREE DRAW CALLS. Trunks, crowns and stumps are three
   *  InstancedMeshes, and that is true with every tree standing and with every
   *  one of them lying down. `tools/checks/forest.mjs` measures it, because a
   *  felling system that spent a draw call per trunk could not be used on a
   *  forest.
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
      /* 19°, and the canopy rather than the sun is what darkens this level — the Ember Shelf's 15° was the previous
       * floor. Under a closed canopy the light that reaches the floor arrives
       * almost horizontally through the trunks, and a low sun through 520
       * vertical rods is what puts the bars of light and shadow across a
       * forest floor that make it read as a forest. `lighting.mjs` orders the
       * indirect budget by sun height strictly, and this level genuinely
       * delivers more of its light as sky than any other. */
      /* 134°, NOT the 84° first written, and the reason is the one the Ember Shelf's
       * block already records: the default pose looks down −z, and a sun 96°
       * away from that sits in the darkest quarter of the dome — so the sky
       * the player is looking at comes out DARKER than the near air standing
       * in front of it, and the far ground overshoots past its own sky.
       * Measured here at 84°, the ground crossed the skyline's luminance at
       * 160 m and settled back under it by 240; at 134° it never crosses.
       * 134 puts the sun 46° off the view axis, which is the same choice the
       * dune sea and the Ember Shelf both make and for the same reason. */
      elevation: 19, azimuth: 134,
      /* 2.4 of key and 0.90 of ambient, not 3.6 and 0.78 — the same shape
       * the Ember Shelf's block derives and for the same reason. Written first at
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
       * The same mistake the Ember Shelf's block records, one level later. */
      groundColor: 0x6a5c3e,
      fillColor: 0x77906a, fillIntensity: 0.58,
      /* AUTHORED, like the Ember Shelf's and for the same reason: `applyAtmosphere`
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
      wind: { from: 134, strength: 1.6, gustiness: 0.7, wander: 0.55 },
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
    /**
     * NO GRASS, AND THIS IS THE FOURTH TIME AND THE FIRST ONE THAT IS NOT A
     * GRASS TUNING.
     *
     * "get rid of the grass on drowned wood completely… it doesn't look
     * stylistic and just looks like complete trash… you need to do something
     * completely different because it's a 1/10 right now." Third repetition of
     * the same note, and the third answer that was a field of upright cover
     * with different numbers on it — browner, then sparser, then with a
     * `swamp` multiplier row on the tier table. All three were the same move.
     *
     * `assets/reference/maps/drowned-wood/dagobah.jpeg` has NO GRASS IN IT AT
     * ALL and no upright cover of any kind. A bog floor is standing water,
     * banks of matted litter, buttress roots and tangles of dead branches, and
     * every one of those is a HORIZONTAL shape. A field of blades is the one
     * surface a bog cannot have, which is why no amount of tuning one was ever
     * going to sit in this frame.
     *
     * So the field is deleted and the floor is geometry: `strewSwampFloor` in
     * this file, eight instanced rungs, with the whole argument written over
     * it. `grass: 0` also moves this level from `world-immersion`'s `field`
     * bucket into its `loose` bucket, which is the honest classification — the
     * bog preset already declares 0.20 m of mantle, and what a player is IN on
     * this level is water and silt, not a lawn.
     */
    grass: 0,
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
      /* WHAT CAME DOWN IN HERE WITH THE HULLS. A wood of eighteen hundred
       * trunks and four hull sections had, measured, ZERO liftable objects on
       * its floor — a level whose only cuttable thing is the trees. The
       * supplies that went down with the wrecks are the honest source. */
      for (let k = 0; k < 6; k++) {
        const site = findSite(world, 20, 140, { clearance: 5, maxSlope: 0.30, minHeight: wet + 0.3, tries: 18 });
        if (site) addCrateStack(world, site.pos, { count: 2 + (rng() * 3 | 0), seed: 5660 + k });
      }
      for (let k = 0; k < 12; k++) {
        const site = findSite(world, 12, 150, { clearance: 3, maxSlope: 0.34, minHeight: wet + 0.1, tries: 14 });
        if (!site) continue;
        if (rng() < 0.35) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.8);
      }
      strewGround(world, { seed: 5620, radius: 180, spread: 0.26, patch: 34, shun: 0.62,
        mat: M.stoneDark, landmarks: 0.7, boulders: 0.8, cobble: 1.2 });

      /* THE FLOOR ITSELF — see `strewSwampFloor` and the `grass: 0` block
       * above. This is the last thing the dressing pass does because it wants
       * the occupancy grid to already hold every trunk, boulder and hull
       * plate: the litter banks and the deadfall are the things that go
       * BETWEEN what is already there, and a floor placed first would push
       * the trees out to make room for it. */
      strewSwampFloor(world, { seed: 8800, radius: 170, wet, spread: 0.46 });

      world.notify('THE DROWNED WOOD', 'cut a trunk and stand clear of it');
    },
  },


};

/* ══════════════════════════════════════════════════════════════════════ */
/*  GEONOSIS — the Command mode's ground                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE ONE LEVEL IN THIS GAME BUILT FOR AN ARMY RATHER THAN FOR A DUEL.
 *
 * Player note #21 asks for a mode where you lead troops, and names the ground:
 * "Imagine for instance the jedi leading the clone troopers on Geonosis … we
 * start with a Geonosis map where you progress further and further on the map
 * with your troops." Eleven reference images were read before any of it was
 * designed, and amalgamated they say something that contradicts every level
 * this project has shipped:
 *
 *   THE BATTLEFIELD IS A FLAT OPEN PLAIN AND THE SIGHTLINES ARE ENORMOUS.
 *
 * Every other level here is a bowl, a cirque, a wash, a shelf or a hall — a
 * shape whose job is to give one Jedi somewhere to fall back to and something to
 * fight around. A line of troops cannot form in a gully and cannot be commanded
 * round a corner. So the whole design is inverted, and the terrain preset's own
 * header carries the measurements: as flat as the arena's fighting floor, and it
 * holds that flatness out to 180 m where the arena's runs into a wall at 60.
 *
 * WHAT MAKES IT A PLACE RATHER THAN A FIELD, since the ground cannot:
 *
 *   THE SMOKE. The single strongest read in every wide shot of this battle is
 *     that the only strong VERTICALS in frame are burning wrecks. On ground with
 *     no landmark they are also the only depth cue there is — see Smoke.js.
 *   THE SPIRES. Geonosian needle stacks, which are a prop rather than terrain
 *     because a 6 m spire on a 1.8 m grid is three vertices wide. They are the
 *     one silhouette that says this is Geonosis and not any red desert.
 *   THE HAZE. Everything past a hundred metres desaturates into an ochre sky.
 *     That is not atmosphere for atmosphere's sake — it is what makes a 620 m
 *     map read as a plain that continues, and it is the same argument the dune
 *     sea's own note makes about painted ranges being a level's edge.
 *
 * ── THE POOL NAMES BOTH ARMIES, AND THAT IS DELIBERATE ──────────────────
 *
 * Every other level's pool is "the things that come for you". This one is "the
 * things that are ON this battlefield", which is two armies, because that is
 * what the images show and because Command lets you lead EITHER of them —
 * `CommandDirector.unlockedAt` filters this list down to whichever side you are
 * not. `roster.mjs` requires every archetype to be reachable from some pool, and
 * this is the pool that reaches the seven bodies Command adds; a level that
 * named only one army would leave the other's five rungs as content that shipped
 * and cannot be met.
 *
 * The repeats are weights (see `WaveDirector._openTypes`): `b1` four times and
 * `trooper` three, because line infantry is what a battlefield is mostly made
 * of, and one each of the elites.
 *
 * ── AND `armies` IS WHAT MAKES THEM TWO ─────────────────────────────────
 *
 * The paragraph above used to end "in an ordinary wave mode the filter does not
 * run and you get both, which is the honest reading of a lone blade dropped into
 * the middle of a war". It was not honest, it was UNMEASURED: composed through
 * the shipped director, wave 3 of this level fields `5xb1 2xb2 2xtrooper` —
 * clone troopers marching at the player shoulder to shoulder with the droids
 * they were sent here to destroy — and nineteen of its first twenty waves mix
 * the two rosters. Command's filter was the only code in the game that knew
 * there were two armies at all.
 *
 * So the level says so, in the two words the wave director reads: a wave here is
 * one army's push and the sides trade them. See `WaveDirector.sideFor` for the
 * rotation, why it is alternation rather than a draw, and why the other nine
 * levels — whose own notes describe a horde rather than a war — are untouched.
 *
 * EVERY ENTRY IN THE POOL BELOW BELONGS TO ONE OF THESE TWO, and it has to:
 * on a level with armies a body whose faction is neither is a body no wave can
 * field, which is the unreachable-content failure `roster.mjs` exists for one
 * layer up. `tools/checks/factions.mjs` holds that line.
 */
Object.assign(ARCHETYPES, COMMAND_UNITS);

LEVELS.geonosis = {
  name: 'Geonosis',
  blurb: 'A red plain under a dust sky, two armies on it, and nothing between them but the ground you have to cross.',
  terrain: 'geonosis',
  armies: ['republic', 'separatist'],
  pool: [
    // The Republic's five rungs, weighted toward the line.
    'trooper', 'trooper', 'trooper', 'heavy', 'sniper', 'jet', 'arc', 'officer',
    // The Confederacy's, weighted the same way.
    'b1', 'b1', 'b1', 'b1', 'b2', 'rocket', 'droideka', 'bx', 'magna',
    // …and the armour. `walker` is this game's Spider Walker and it is exactly
    // the OG-9 homing spider droid of the reference plates: a sphere on four
    // very tall thin legs with a single beam off the top. It is the silhouette
    // that reads at any distance, which is what a heavy on this map is for.
    'walker',
    /**
     * THE MACHINES, one entry each and no repeats.
     *
     * `src/game/Vehicles.js` builds these four off the twenty-four vehicle
     * plates in `assets/reference/vehicles/`, and this is the pool that makes
     * them reachable — `roster.mjs` fails on any archetype no pool names, which
     * is what stops four bodies somebody modelled, priced and gave a silhouette
     * to from being content that shipped and cannot be met.
     *
     * UNWEIGHTED, and deliberately, against seventeen infantry entries above.
     * Repeats in a pool are weights (see `WaveDirector.unlockedAt`), so one
     * entry each puts a machine at roughly one draw in twenty-one — and
     * `heavyLimit` caps how many can be on the field at once regardless, because
     * an AT-TE is a great many meshes. The reference plates agree: a wide shot
     * of this battle has hundreds of infantry and three or four machines.
     */
    'dwarfspider', 'hailfire', 'aat', 'atte',
  ],
  /* The ochre the whole level is graded around: dust puffs, footfall grit, the
   * hemisphere's lower half and the smoke's own tip all derive from it. */
  groundColor: 0xa9764a,
  /* THE WIDEST SPAWN RING IN THE GAME, and it is the level's premise stated as
   * two numbers. Everywhere else this is 26-60 m, which is "they are already on
   * top of you". Here you are meant to SEE them coming and have time to give an
   * order about it: 58 m is beyond the range of everything in the roster except
   * the marksman, and 96 m is the far end of what the haze lets you resolve. A
   * march arrives at 1.45× the outer ring — 139 m — which is a real advance
   * across open ground and is the thing the reference plates are full of. */
  spawnRadius: [58, 96],
  atmosphere: {
    /* A sky that is mostly dust. Turbidity high and mie high — mie is forward
     * scatter off big particles, which is what suspended grit is — and rayleigh
     * DOWN but not off, for the reason the Ember Shelf records at length: under
     * about 1.6 the physical model returns so little radiance that the exposure
     * meter hits its clamp and stops metering the level at all. 2.0 keeps the
     * model in range and the ORANGE comes from the sun, the cloud deck and the
     * grade, which is where a colour that is not physics belongs. */
    turbidity: 10.0, rayleigh: 2.0, mie: 0.016, mieG: 0.85,
    /* The wind on this preset runs along (0.94, 0.34) — 20° — and the sun sits
     * anti-parallel to it at 200°, which is the same rule the dune sea derives
     * for its dune train: the windward faces of the stacks are lit and their lee
     * faces are in shadow, so the one landform on the map has a light side and a
     * dark side to be read by. The elevation below is a late-afternoon sun, which
     * is what every plate of this battle is shot in — long shadows off infantry
     * are how you read a crowd on flat ground. (It said "21°" here and the
     * elevation has been 20 and is now 18; the prose is left pointing AT the
     * number instead of repeating it, which is the only version of this that
     * cannot go stale.) */
    /* 18°, AND THE HISTORY OF THIS NUMBER IS THE ARGUMENT FOR IT.
     *
     * `cel: a shadow is READABLE` compares levels pairwise: if one level's sun
     * stands more than 10% higher than another's, more of its shadow has to
     * come from the key, or the shadow tone is not tracking the light. At 21°
     * geonosis failed that against the wood — sunY 1.10075, over the gate by a
     * whisker — because it had the HIGHEST sun on the roster and, from the note
     * below, the highest ambient too (0.52). Those two together are a
     * contradiction: a dust-laden sky is a DIFFUSE sky, and a level cannot
     * claim both the strongest sun and the weakest key share. It went to 20°.
     *
     * THAT FIX WAS RIGHT AND HALF-DONE, and the half it missed is why this
     * number moves a second time. It was measured against ONE neighbour — the
     * wood — and the pairwise clause is over every pair. At 20° geonosis' sun
     * still stood 24% above Kamino's and still took LESS of its shade from the
     * key (35.8% against 36.4%), so the clause was still red; nobody saw it
     * because the rank-correlation assert on the line above fires first and
     * masked it. Two failures were hiding behind one message.
     *
     * The deeper reading is the same one, taken all the way. Sun height is this
     * check's proxy for how much air the beam crosses, and turbidity 10.0 — the
     * highest in the game, this level's defining knob — is that same optical
     * depth arriving by another route. A sky choked with grit behaves like a
     * lower sun, so a level whose whole look is "weak key, strong sky, flat
     * shadowless light" cannot also hold the roster's third-highest sun. At 18°
     * it sits between the White Pass's 17 and the Drowned Wood's 19, which is
     * where its own light already was.
     *
     * It costs the look nothing and it pays it: the note above wants long
     * infantry shadows off a flat plain to read a crowd by, and a LOWER sun
     * throws longer ones. 18 rather than 19 because `lighting.mjs` orders the
     * indirect budget by sun height STRICTLY, so a tie with the wood at 19 is a
     * failure — measured, that is exactly what 19 produces.
     *
     * Measured after, this level alone: key share 35.8% → 34.0%, lit-to-shade
     * 1.83:1 → 1.79:1 (cel's band is 1.3–2.2), cast-shadow contrast 2.86
     * against the 2.62 an 18° sun owes, indirect budget 39% → 41% and still
     * strictly between the wood's 40% and the White Pass's 43%. */
    elevation: 18, azimuth: 200,
    /* A dusty sun is a WEAK sun with a strong sky, and that ratio is the whole
     * look. 5.4 against the dune sea's 7.6, with the ambience carrying more of
     * the load, gives the flat shadowless light the wide shots have — but not
     * so flat that the stacks lose their form, which is what the check that
     * orders the indirect budget by sun height is protecting. */
    sunColor: 0xffcf8e, sunIntensity: 5.4, ambient: 0.52,
    /* THE GROUND HALF OF THE HEMISPHERE IS RED, WHERE THE SKY IS YELLOW, and
     * that difference is the point rather than a decoration. This is the colour
     * of the light the GROUND THROWS BACK UP, and on Geonosis the ground is
     * red-ochre dirt while the sky is pale dust — B/R 0.26 against the sky's
     * 0.41, a 35% shift into the shade. Authored the other way round (a ground
     * within a few per cent of its own sky) the term is arithmetically present
     * and unrecoverable from the frame, which is the exact failure
     * `lighting.mjs`'s "the ground colour every level authors reaches the frame"
     * exists to catch — it caught this one at 0.4%. */
    skyColor: 0xd9a058, groundColor: 0x8a4a24,
    /* THE FILL IS WARM HERE, and that is the one thing about this level's light
     * that is not the default. Everywhere else the brightest thing that is not
     * the sun is a BLUE sky, so a fill placed opposite the key stands for the
     * dome and is blue. Under this much dust the dome is orange — there is no
     * blue anywhere in any of the eleven reference frames — and a blue fill
     * would be a lamp nobody has switched on. The same argument the Ember Shelf
     * makes about its lava sea, from the other direction. */
    fillColor: 0xd6a06a, fillIntensity: 0.50,
    /* THICK, AND THE THICKEST IN THE GAME. 0.0060 against the dune sea's 0.0044
     * — this is the level whose whole subject is a distance you have to cross,
     * and the haze is what turns 620 m of heightfield into a plain that
     * continues past its own edge. Dimmer and less saturated than the drawn sky,
     * because a surface seen THROUGH a medium cannot come out brighter than the
     * medium; authoring this as a sand swatch is how a haze ends up above its
     * own sky. `fogHeight` is deliberately tall: a LOW mist would reveal the far
     * stacks rather than bury them (measured on the dune sea — a ray to a
     * distant crest climbs out of shallow fog almost immediately), and on this
     * level the far ground is meant to dissolve. */
    fogColor: 0xd0a473, fogDensity: 0.0060, fogHeight: 70, fogBase: 0,
    /* Warm tops and cooler undersides, and a heavy deck: the sky in these plates
     * is banded brown-orange cloud with the sun burning through it rather than
     * open air. */
    cloudCover: 0.52, cloudLit: 0xffdda6, cloudDark: 0xa8825e,
    cloudWindDir: 0.35, cloudWindSpeed: 0.9,
    /* The painted ranges: distant mesas, which the terrain's own far rim rises
     * into so they stand ON something instead of floating at the edge of a
     * plane. Three layers out to 380 m — the deepest set in the game, because
     * this is the level that is about looking a long way. */
    horizonAmount: 1.0, horizonScale: 0.95, horizonColor: 0xa06a3e,
    exposure: 0.88, saturation: 1.04,
  },
  /* A hot wind over open ground, and under it the low continuous rumble of a
   * battle that is happening whether or not you are in this part of it. */
  ambience: { wind: 0.26, windFreq: 520, drone: 0.09 },
  dust: {
    count: 2100, color: 0xc9a074, opacity: 0.46, size: 34,
    fleckColor: 0xa87c4c,
    wind: { from: 200, strength: 2.8, gustiness: 0.48, wander: 0.24 },
    /**
     * A DUST FRONT, AND IT IS THE ONE THING THAT CAN CLOSE THIS MAP DOWN.
     *
     * Every other level's weather changes how it looks. On the one level whose
     * entire premise is a sightline, weather changes how it PLAYS: you order a
     * line abreast because you can see the other army at ninety metres, and
     * when the front comes through you cannot, and the order you gave two
     * minutes ago is now the wrong one. That is the mechanic, and it is why this
     * level gets a front rather than a haze.
     *
     * `period` 146 s against `duration` 44 is the loosest cadence in the game —
     * the dune sea storms for 48 of every 92 — because a front that is on more
     * than it is off would make "you can see a long way" false, and that
     * sentence is the level. Every 132 s it stops being true for 44, and the
     * rest of the time the plain is open.
     *
     * `fogGain` 3.4 rather than the dune sea's 6.14: the air here is ALREADY
     * the thickest in the game (fogDensity 0.0060 against 0.0044), and the fog
     * cap binds at 0.030 — a gain that reaches the cap before the front has
     * finished crossing stops the front being an event. 3.4 takes it to 0.0204,
     * which is inside the cap with room, and it is what takes visibility from
     * about 160 m to about 50.
     *
     * `sunLoss` 0.72 rather than 0.90 for a related reason: this level's key is
     * already the weakest in the game (5.4) with the ambience carrying the
     * load, so killing nine tenths of it leaves nothing to model the stacks
     * with and the map goes flat rather than dark.
     */
    weather: { peak: 0.94, period: 146, duration: 44, unrest: 0.20, span: 240,
               fogGain: 3.4, windGain: 2.6, sunLoss: 0.72, fillGain: 1.4, tint: 1.0 },
  },
  /* NO GRASS. Nothing grows on a deflation plain, and the one surface a battle
   * like this cannot have is a lawn — the same finding that deleted the meadow
   * and stripped the dune sea. What stands in for it is the deepest surface
   * memory in the game (`loose.depth` 0.24, `refill` 240 s on the preset): the
   * ground here is a record of where the two armies have already walked, and it
   * keeps it for four minutes rather than the dune sea's minute and a half. */
  grass: 0,
  dress(world) {
    const M = propMaterials();
    beginDressing(world, 20250805 + 91);
    /* THE FAR SIDE. Three layers, the outermost at 380 m — further than any
     * other level, because the whole promise of this ground is that you can see
     * across it. Low and long rather than tall and jagged: these are mesas and
     * buttes, and the needle spires are placed separately below. */
    addHorizon(world, {
      seed: 9110,
      layers: [
        { radius: 208, low: 10, high: 30, shade: 0.60 },
        { radius: 286, low: 20, high: 52, shade: 0.70 },
        { radius: 380, low: 34, high: 84, shade: 0.80 },
      ],
    });

    /* THE SPIRES. `makeSpire` builds a wasp-waisted eroded needle with a cap
     * rock — which is exactly the Geonosian stack in `more geonosis
     * landscape.jpeg` — and it is a prop rather than terrain because a 6 m
     * spire on a 1.8 m heightfield grid is three vertices wide and comes out as
     * a lump. Nine of them, out past 80 m so the fighting ground stays open,
     * clustered in threes so they read as a group of stacks rather than as nine
     * evenly spaced posts. */
    /* SEVEN CLUSTERS OF THREE, out past 62 m so the ground you form up on stays
     * open. Clustered rather than scattered because that is what the landscape
     * plate shows — stacks come in groups with open plain between the groups —
     * and because `world-immersion`'s silhouette gate is about COVERAGE: a
     * plain wants something over 1.2 m within 25 m of everywhere you can stand.
     * That gate caught this level at 22.4% bare against a 12% bar on the first
     * pass, and it was right to. "You can see a long way" is only interesting if
     * there is something out there to see. */
    for (let k = 0; k < 7; k++) {
      const base = findSite(world, 62, 235, { angle: (k / 7) * TAU + rng() * 0.6, clearance: 20, maxSlope: 0.30 });
      if (!base) continue;
      for (let i = 0; i < 3; i++) {
        const a = rng() * TAU, d = 4 + rng() * 16;
        const p = base.pos.clone();
        p.x += Math.cos(a) * d; p.z += Math.sin(a) * d;
        p.y = world.terrain.height(p.x, p.z);
        makeSpire(world, p, 14 + rng() * 28, { mat: M.stone });
      }
    }

    /* THE WRECKS, and there are more of them here than anywhere else. This is
     * the one level where the fiction is that a battle has ALREADY been going
     * on — you are joining it — so the hulls are the level's own history and
     * they are what every smoke column is standing on. */
    strewWrecks(world, { seed: 9120, count: 14, rmin: 34, rmax: 235, mat: M.hull });
    /* AND WHAT AN ARMY LEFT ON IT. This level's own note says the fiction is
     * that the battle has already been going on and you are joining it, and
     * fourteen wreck clusters said so at the SCENERY scale while the floor
     * between them held one liftable object in total. Ammunition crates,
     * fuel drums and the stacks they came off. */
    for (let k = 0; k < 10; k++) {
      const site = findSite(world, 22, 190, { clearance: 6, maxSlope: 0.30, tries: 18 });
      if (site) addCrateStack(world, site.pos, { count: 2 + (rng() * 4 | 0), seed: 9160 + k });
    }
    for (let k = 0; k < 16; k++) {
      const site = findSite(world, 14, 200, { clearance: 3, maxSlope: 0.34, tries: 14 });
      if (!site) continue;
      if (rng() < 0.4) makeBarrel(world, site.pos); else makeCrate(world, site.pos, 0.84);
    }

    /* THE SMOKE. See src/world/Smoke.js: seven columns, one draw call, leaning
     * downwind on the preset's own wind vector so they agree with the drifted
     * sand and the shadows. The tip colour is the fog's, so a column dissolves
     * into the haze at its top rather than ending in mid-air. */
    addSmokeColumns(world, smokeSites(rng, 7, { rmin: 62, rmax: 244, phase: 1.1 }), {
      wind: [0.94, 0.34], color: 0x33261f, tip: 0xd0a473, lean: 0.55, spread: 0.22,
    });

    /* Cover, such as it is. A deflation plain has boulder fields and low
     * outcrops and nothing else, and the sparseness is the point: `take cover`
     * is an order you can give on this map and it will not always find you
     * anything. Kept OUT of the middle 40 m, so the ground you form up on is
     * clear. */
    for (let k = 0; k < 16; k++) {
      const site = findSite(world, 26, 210, { angle: (k / 16) * TAU + rng() * 0.5, clearance: 11, maxSlope: 0.34 });
      if (!site) continue;
      addOutcrop(world, site.pos, { size: 3.5 + rng() * 5, height: 3.0 + rng() * 5.5, seed: 9130 + k, mat: M.stone });
    }
    /* `landmarks` is `strewGround`'s own boulder-sized grade and it is turned
     * UP here rather than down. On every other level the loose rock is texture
     * under your feet; on a plain with no landform it is the only thing between
     * two horizons, so it is doing the job a ridge does elsewhere. */
    strewGround(world, { seed: 9140, radius: 235, spread: 0.30, mat: M.stone,
      landmarks: 1.5, boulders: 1.3, cobble: 1.2 });
    return 12;
  },
};

/**
 * The order the menu lists them in: the outdoor grounds first, because those
 * are the ones that read as PLACES, and the one interior last.
 *
 * That ordering is not taste. Seven levels replaced thirteen on the finding
 * that "your outdoor maps look good because they're immersive and have a
 * feeling of place, whereas your interior maps remind you that this is an AI
 * game" — a roof plus four walls at the draw budget this engine has is a box,
 * and a box is the one shape that cannot be anywhere. The survivors are led by
 * their strongest.
 */
/* THE NEW GROUNDS GO IN BY SUBJECT, NOT BY DATE. Mustafar sits beside the
 * Ember Shelf because they are the same planet at two scales and a player
 * should meet them next to each other.
 *
 * THERE ARE NO INTERIORS LEFT AND THAT IS THE WHOLE OF THE LIST NOW. The Jedi
 * Temple, the Foundry and Kamino were struck on instruction — "get rid of the
 * jedi temple map… in general I find that you do better with maps out in the
 * open where you can use tricks to increase the immersion… so just get rid of
 * all your maps that take place indoors", and "get rid of the kamino map
 * entirely", and "get rid of the foundry completely". Every level below is
 * open sky. The roster went 13 → 10 → 7 by the same reasoning each time and
 * the reasoning has never once been contradicted by a player note. */
/* THE FIRST ENTRY IS ALSO THE FALLBACK, which is not obvious from here and
 * cost a round to find out. `World.loadLevel` resolves an unknown key to
 * `LEVELS[LEVEL_ORDER[0]]`, and four checks still name levels that were deleted
 * — `deeps`, `warship`, `intake`, `cut`, `arena` — so those silently measure
 * whatever stands first here, five times over. Putting Mustafar first therefore
 * "broke" the Cut's standing-water test and the nav walk without touching
 * either: they were measuring Mustafar's lava rivers. The Ember Shelf keeps the
 * slot it has always had. */
export const LEVEL_ORDER = ['scoria', 'mustafar', 'colosseum', 'wood', 'drifts', 'alpine',
  'geonosis'];

/**
 * DELETED LEVELS.
 *
 * The dune sea, the wash, Hangar Bay Nine and the dojo were removed at the
 * player's request, and they are gone — no aliases, no shim.
 *
 * SIX MORE FOLLOWED, on the same principle and the same authority: the Green
 * Reach, the Sanctum, the Temple Halls, the Intake, the Invisible Hand and the
 * Cut. Each was named, and the reasons sort into three:
 *
 *   - the ground broke the art direction (the Green Reach's grass, and the
 *     same fault is why the Drowned Wood's is being rebuilt rather than kept),
 *   - the room was a box (the Temple Halls, the Intake, the Cut — and the
 *     Invisible Hand, which is a box with a window),
 *   - it was simply weaker than the six around it (the Sanctum).
 *
 * Thirteen levels of which six were bad is a worse product than seven that are
 * not, because a menu is judged by what a player can pick wrong. The Temple
 * Halls and the Invisible Hand are the two whose SUBJECTS survive the deletion
 * — a Jedi temple and a flagship are both worth building, from reference, as
 * new levels rather than as edits to these.
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
 * DojoDirector on the MODE alone, and the director places everything it spawns
 * relative to the PLAYER and reads nothing at all off the level. The eleven
 * lessons now run in whichever theatre the player picked, which is what the
 * comment in World.js already said they should. `Dojo.js` still exports
 * `DOJO_LEVEL`; nothing imports it.
 *
 * The `L.training ||` half of that test went with the room — no level in this
 * file sets the flag any more (`grep -c 'training:'` returns 0), so it was a
 * branch that could not be taken.
 */


/**
 * THE GROUND A RUN WALKS, IN ORDER — and it is a property of the RUN.
 *
 * Player note #48 asks for the map to change between rounds rather than the
 * player fighting on the same ground forever. Three things could have owned
 * that list and two of them are wrong:
 *
 *   NOT THE LEVEL. A level would have to name the one that follows it, and
 *     seven `next:` fields are a second ordering standing beside LEVEL_ORDER.
 *     This roster has been cut twice (13 → 10 → 7) and each cut would have had
 *     to repair a chain of pointers as well as a list — which is the
 *     hand-maintained-twin defect in its purest form. The alias block above
 *     records what the last cut cost when only FOUR checks named dead levels.
 *   NOT THE MODE. A mode is a set of rules, and the same rules have to be able
 *     to produce two different runs. A rotation stored on the mode sends every
 *     skirmish anybody ever plays to the same grounds in the same order.
 *   THE RUN. `world.runSeed` is the number `main.js` draws on every deploy and
 *     that `seedWaves`, `enemyRng`, `duelRng`, `seedArrivals` and `seedCommand`
 *     already fan out from. One more stream off it makes WHERE a run is fought
 *     part of the same shareable number as what arrives on it, so "beat this
 *     seed" finally includes the ground.
 *
 * DERIVED FROM `LEVEL_ORDER`, so a ground deleted from the roster leaves the
 * rotation on the same commit and a ground added joins it on the same commit.
 * There is no playlist to keep in step.
 *
 * BAGGED, NOT SAMPLED, and the difference is the whole of whether it feels like
 * a rotation. Measured over 10,000 seeds of a six-round run on the shipped
 * seven-level roster:
 *
 *                        two rounds running on one ground   a ground never seen
 *   independent draws                 54.2%                       95.7%
 *   a shuffled bag                     0.0%                        0.0%
 *
 * A bag is a permutation, refilled and reshuffled when it empties, so every
 * ground is visited once before any is visited twice. The only seam left is the
 * bag BOUNDARY — a fresh bag may open on the ground the last one closed with —
 * and over twelve rounds that happens on 14.22% of seeds, which is exactly the
 * failure the player asked to be rid of arriving once every two laps. Rotating
 * such a bag by one is the smallest fix that keeps it a permutation: 0.00% over
 * the same 10,000 seeds.
 *
 * @param seed    the run's number.
 * @param pool    which grounds are in play. Defaults to every shipped one, and
 *                anything not in LEVELS is dropped rather than trusted — a
 *                saved profile may name a level that has been deleted.
 * @param length  how many rounds to lay out. Defaults to one full bag.
 * @param first   a ground pinned at index 0 — the one the player picked on the
 *                Deploy panel, so round one is where they said it would be and
 *                the rotation takes over after it. Ignored if it is not in the
 *                pool, which is the same fallback `World.loadLevel` applies.
 * @returns an array of `length` LEVELS keys.
 */
export function levelRotation(seed, { pool = LEVEL_ORDER, length = 0, first = null } = {}) {
  const grounds = (Array.isArray(pool) ? pool : LEVEL_ORDER).filter((k) => LEVELS[k]);
  if (!grounds.length) return [];
  const want = Math.max(1, Math.round(Number(length) || 0) || grounds.length);
  /* Its own stream off the run's number, mixed the way `seedWaves` mixes the
   * rung in: two runs one apart must not walk near-identical ground, and a
   * bare `makeRng(seed)` shares its whole sequence with anything else that
   * seeds the same way. The module's own `rng` is the DRESSING stream and is
   * deliberately not touched — `beginDressing` owns when that one is reset. */
  const r = makeRng((Math.imul((seed | 0) ^ 0x51ED2701, 0x2545F491) >>> 0) || 1);
  const pin = first && grounds.includes(first) ? first : null;
  const out = [];
  while (out.length < want) {
    const bag = grounds.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    if (!out.length && pin) {
      // The player's pick opens the run; the shuffle decides everything after
      // it. Moved rather than prepended, so the first bag stays a permutation
      // and the pinned ground is not also drawn again later in the same lap.
      bag.splice(bag.indexOf(pin), 1);
      bag.unshift(pin);
    } else if (out.length && bag.length > 1 && bag[0] === out[out.length - 1]) {
      bag.push(bag.shift());
    }
    for (const k of bag) { if (out.length >= want) break; out.push(k); }
  }
  return out;
}


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
 *   scoria    open sky over a lava sea. A gunship can fly in — and on a
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
  scoria: ['dropship', 'dropship', 'march'],
  colosseum: ['gate'],
  /* A canopy no gunship can come through, and no gate either. Whatever is in
   * this wood walks out of it.
   *
   * AND THE TABLE NOW SAYS WHAT THE SENTENCE ABOVE IT SAYS. It listed
   * `dropship` as one entry in three — a gunship hovering over a closed
   * canopy — while the comment beside it said the opposite, which is the shape
   * HANDOFF §2.4 warns about from the other end: a comment and its code
   * disagreeing, with the comment right. It also made `arrivals.mjs` FLAKY
   * rather than wrong: an arrival opens one flight per kind and a wave opens
   * about three, so "open wood never once used a dropship" came up roughly
   * (2/3)³ ≈ 30% of runs. Observed failing twice in a row on a clean tree
   * before this change and never since. */
  bog: ['march'],
  /**
   * GEONOSIS IS THE ONE GROUND WHERE THE MARCH IS THE POINT.
   *
   * Every other open level weights two ships to one march, and the reason is
   * stated in Arrivals.js: "a march is honest but it is also 80–100 m of walking
   * before the body is in the fight, and a wave made mostly of them is a wave
   * you spend watching."
   *
   * That argument inverts here, and it inverts for the same reason the terrain
   * does. This level's whole subject is an army crossing open ground toward you,
   * the reference plates are of nothing else, and Command is a mode about giving
   * an order BEFORE the contact rather than reacting to one that has landed on
   * top of you. A wave you watch advance is the wave this level is for. So it is
   * two marches to one ship — and the ship is still there because a gunship
   * flaring in over a flat plain is the other image these plates are full of.
   */
  geonosis: ['march', 'march', 'dropship'],
  /* Open sky over a lava field, and the ground between the rivers is broken
   * enough that a march is a real approach rather than eighty metres of
   * watching — so both, weighted to the ship the way the open levels are. */
  mustafar: ['dropship', 'dropship', 'march'],
});

/**
 * THE THING AT THE END OF THE SHIFTING WASTE — it was the warship's, then the
 * foundry's, and both are deleted. `bodyguard` reaches the field through
 * exactly ONE pool at any time, so each deletion would have quietly deleted a
 * 1050-hp set-piece with it: an archetype no pool names is unreachable, which
 * is the same silence that kept `beast` out of ordinary waves for so long, and
 * `roster.mjs` caught it both times within a minute of the level going.
 *
 * The Waste inherits it because the escalation argument below is about POOL
 * SHAPE — a droid-heavy ladder with the walker and the droideka on it — and
 * `drifts` is the closest surviving pool to the one this was tuned against:
 * b1/b1/trooper/b2/sniper/droideka/acolyte/walker, the same ladder one rung
 * shorter.
 *
 * Registered here for the same reason the arrivals above are: a level and the set-piece it ends with are one decision,
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
    /**
     * DJEM SO, DECLARED — a boss cannot roll its own fight on spawn.
     *
     * This archetype gave `Enemy._build` no `form`, so it took the random
     * branch: `FORM_KEYS[floor(rng() * 5)]`. A 1050 hp set-piece that fights a
     * different way every time it is met is a boss with no counter-play to
     * learn, and the note over the four Jedi in src/game/Enemy.js says exactly
     * that about the roster it was written for.
     *
     * Which form is not a preference either. The MagnaGuard in
     * src/game/Command.js is the same chassis carrying the same electrostaff at
     * a quarter of the health, and it already declares `djemSo` — so the two IG
     * bodies fight alike and the smaller one is the rehearsal. It also suits
     * the weapon: Djem So is 3 heavy attacks and 1 unblockable, none of them
     * parryable, which is a two-metre arc staff swung by 240 kg of droid rather
     * than a fencer's blade. Its 0.58 s recovery is the longest opening in the
     * game, and with the WINDED window below it is what this fight is made of.
     */
    form: 'djemSo',
    /* THIS DROID ARRIVES AS A SET-PIECE AND NEVER AS FILL, and it now SAYS so.
     *
     * It always did — but by omission: `unlockedAt` used to build its list from
     * a hand-written ladder of seven names, so anything not on it and carrying
     * no `unlockAt` was invisible to the fill. That is the same silence that
     * kept `beast` off the Colosseum, whose entire premise is exotic creatures,
     * and the Jedi Master off the Temple. When the fill was made to honour
     * every pool entry, this general started arriving in threes on wave 12 and
     * `tools/checks/warship.mjs` caught it — correctly, and against an intent
     * nothing in this record had ever stated. Now it is stated. */
    setPieceOnly: true,
    /* `armorPlus` is read by Enemy._boneToughness and sends the TORSO to
     * durasteel while leaving the limbs alone. On a boss that is the whole of
     * the counter-play: you are not going to cut this in half across the
     * chest, and you do not have to — the legs are still legs. */
    armorPlus: true,
  },
});
SET_PIECE.unshift({ type: 'bodyguard', from: 10 });

/**
 * THE MASTER'S RUNG, and why a duelling ground gets one at all.
 *
 * `_setPiece` is the only door a `boss` archetype has — it fires on every fifth
 * wave and fields two or three bodies off this ladder, filtered by whether the
 * level's own pool names the type. Before this the duelling ladder was
 * `acolyte` and nothing else, so the level built for duelling had the LIGHTEST
 * rung in the game as its climax: measured on the shipped pool, every boss wave
 * from 5 to 40 fielded exactly two Sith Acolytes.
 *
 * THE POSITION IS FOUND, NOT TYPED. `_setPiece` walks this array in order and
 * takes one of each rung it can afford, so the array is a descending threat
 * ladder — and an index literal here would be wrong the first time anybody
 * unshifts another rung above it (which the line directly above this one does).
 * The Master costs 12, the same as the walker and one under the bodyguard, so
 * it belongs immediately before the droideka's 5. Found by name.
 *
 * `from: 10` rather than 5, for the reason the walker's rung is 10: at wave 5
 * the whole set-piece spend is `max(0.28 x 26, 2 x lightest)` = 12, which buys
 * exactly one Master and nothing behind it — and one duellist alone on a boss
 * wave is a quieter wave than the one before it. At 10 the spend is 17 and the
 * ladder has three rungs under it, so the Master arrives with a Guardian or a
 * pair of Knights and the wave reads as the order closing ranks.
 */
SET_PIECE.splice(SET_PIECE.findIndex((s) => s.type === 'droideka'), 0, { type: 'master', from: 10 });

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
 * WHAT THAT USED TO MEAN, AND WHY IT WAS NOT ENOUGH. `Enemy._beastBrain` gates
 * its move set on the fraction of health remaining: phase 1 (over 66%) can only
 * LUNGE, phase 2 (over 33%) adds the SWEEP, and phase 3 adds the CHARGE, with
 * the interval between attacks falling from 2.4 s to 1.15 s across the three.
 * So a creature's health pool is not only how long it takes to kill — it is how
 * much of the fight is spent in each move set. That is real, and it is what the
 * first three creatures are built out of.
 *
 * But it is all it was: three animals, ONE move set, and therefore one answer.
 * Measured over 90-second fights, 0 of 108 sweeps and 0 of 94 lunges land on a
 * player who breaks sideways through the telegraph, on any of the three — so
 * whichever creature is on the sand, the verb is the same and a player who has
 * learned to circle at knife range has learned all three.
 *
 * `BEAST_MOVES` (src/game/Enemy.js) makes the move set a property of the
 * ARCHETYPE, and the two creatures added below are added for their ANSWERS
 * rather than for their health bars:
 *
 *   the BRUTE     the SLAM, whose footprint is centred on the animal's own feet
 *                 at the moment of impact rather than on a point it remembered.
 *                 Measured: 100% of slams land on a player circling at knife
 *                 range — the evasion that takes 0% of every claw in the game —
 *                 and 0% on one who breaks the ring. Its answer is DISTANCE,
 *                 and it is the only creature that has that answer.
 *   the POUNCER   the POUNCE, which commits its landing point 0.55 s into the
 *                 wind-up and does not arrive until 0.95. Measured: 0% land on
 *                 a player who breaks late, 95%+ on one who breaks early and
 *                 has stopped again by the time it comes down. Its answer is
 *                 TIMING, and it is the exact opposite habit to the brute's.
 *
 * Add the hit radii, which scale with `scale`, and the engagement band, which
 * is `preferred`, and the five read as five animals:
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
 *   the BRUTE     2200 hp, 3.4 m/s, scale 3.4, reach [3, 6]. The slowest thing
 *                 on the sand and the largest, and neither is what makes it
 *                 hard: the slam covers 7.0 m of ground centred on the animal,
 *                 which is wider than the band it fights at, so every metre you
 *                 spend beside it is a metre you have to give back. It is also
 *                 the one creature the FOOTWORK habit actively kills you on.
 *   the POUNCER   560 hp, 7.2 m/s, scale 2.0, reach [2, 3.8]. The thinnest
 *                 health pool of the five, so it is at phase 3 in seconds — and
 *                 it opens with the pounce, which is available at phase 1. It
 *                 crosses twelve metres in four tenths of a second, so backing
 *                 away is not an answer to it either; the answer is the last
 *                 tenth of the telegraph.
 *
 * ── SOME RIDDEN, and now two of the five. The charger carries a B2 (see
 * src/game/Riders.js): a gunner three metres up, out of the blade's reach, on
 * something that will not stand still. The BRUTE carries a MARKSMAN, and the
 * pairing is the point of it: the mount's answer is to get out of the ring, and
 * out of the ring is exactly where a 34-damage aimed shot with a 1.0 s
 * targeting line wants you to be. Neither half can be answered without making
 * the other half worse, which is what a set-piece is for.
 *
 * And both are PAID FOR: the mount's threat includes the rider's, so a wave
 * with two crewed chargers in it is a wave with six fewer droids, not a wave
 * 30% over budget. `saddleThreat` reads that price off the archetype table, so
 * the arithmetic cannot drift out of step with the body it is paying for.
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
  brute: {
    label: 'Rancor', build: (o) => buildQuadruped({ ...o, kind: 'brute' }),
    scale: 3.4, hp: 2200,
    /* 1700 kg for the reason the Reek is 1650, and it is worth repeating rather
     * than cross-referencing because the next person to type a number here will
     * want to type 4000: `force.mjs` asserts the highest lift cap clears the
     * heaviest body in the ARCHETYPES table, and that cap is 1760 kg. A
     * creature above it would be the one body in the game the Force cannot
     * move, which reads as a broken power rather than as a heavy animal. */
    mass: 1700,
    speed: 3.4, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    /* ITS MOVE SET, WHICH IS THE WHOLE ARCHETYPE. `slam` unlocks at phase 1 —
     * it is not a reward for hurting the animal, it is the first thing it does
     * and the thing the player has to learn — and the sweep arrives at 2. There
     * is no charge on this list: something that weighs 1700 kg and moves at
     * 3.4 m/s does not run you down, and giving it every attack in the table
     * would have made it the others with more health, which is the exact defect
     * the menagerie note above says these exist to fix. */
    moves: ['slam', 'lunge', 'sweep'],
    damage: 48, preferred: [3.0, 6.0], score: 3400,
    big: true, unlockAt: 3,
    /* A marksman in the howdah, not a B2. `_measurePlatform` gives a `big` body
     * a real standing surface off its own geometry — 3.6 m up on this one — so
     * the rider is genuinely out of reach of a blade, and a 1.0 s targeting
     * line on a body you have just been forced to back away from is the pairing
     * the menagerie note describes. */
    saddle: 'sniper', threat: 0,
  },
  pouncer: {
    /* WAMPA, which is what was actually built. CREATURE_PLANS.pouncer says so
     * in its own first line — "built off `wampa.jpg` and `Wampas preyed on
     * tauntauns.webp`" — and everything below it describes that animal: horns
     * curving sideways out of the skull, a shag coat, the head sunk between the
     * shoulders, the arms held high in "the wampa's reaching pose". A gundark
     * is a four-armed, big-eared biped and this has two arms and no ears. The
     * body is right and the label was the thing that was wrong.
     *
     * It stays in the menagerie rather than moving to the White Pass: an arena
     * that ships in creatures is exactly where a cold-world predator turns up,
     * and moving it is a pool-composition change with its own measurements to
     * make. `pouncer` is still the key everything reads. */
    label: 'Wampa', build: (o) => buildQuadruped({ ...o, kind: 'pouncer' }),
    scale: 2.0, hp: 560, mass: 520,
    speed: 7.2, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    /* Pounce at phase 1, because a creature whose signature move only appears
     * once you have taken two thirds of its health off is a creature most
     * players never see do it — and this one has the thinnest health pool of
     * the five. Charge at 3 is the escalation: when it is nearly dead it stops
     * leaping and simply runs at you. */
    moves: ['pounce', 'lunge', 'charge'],
    damage: 30, preferred: [2.0, 3.8], score: 1500, threat: 8,
    big: true, unlockAt: 1,
  },
});
/* Priced with what it carries. 11 of its own — between the walker's 12 and the
 * droideka's 5, which is where a 1250 hp animal that cannot shoot belongs — and
 * the B2 on its back at whatever a B2 costs. */
ARCHETYPES.charger.threat = 11 + saddleThreat('charger');
/* And the same arithmetic for the brute: 15 of its own — over the acklay's 16
 * would be wrong, because the acklay can reach you from outside your own reach
 * and this cannot, but under the walker's 12 would be wrong too at 2200 hp —
 * plus whatever a Marksman costs, read off the table rather than typed. */
ARCHETYPES.brute.threat = 15 + saddleThreat('brute');
