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
  addWall, addRock, BlastDoor, propMaterials,
  addColumn, addArch, addBrokenWall, addColossus, addOutcrop, addScree,
  addDebrisField, addCrateStack, addRuin, addOutpost, addGantry, addPipeRun,
  addCableRun, addLamp, addScaffold, addRockArch, addBoulderCluster, addHullSection, addTarp,
  addAntenna, addPlinth,
} from '../world/Props.js';
import { addHorizon, makeCoverField, ground } from '../world/Scenery.js';
import { makeRng, clamp, TAU, lerp } from '../engine/MathUtil.js';
import { DOJO_LEVEL } from './Dojo.js';

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


export const LEVELS = {
  dojo: DOJO_LEVEL,
  dunes: {
    name: 'The Dune Sea',
    blurb: 'Open dunes under a white sun. Nothing between you and the horde but sand.',
    terrain: 'dunes',
    pool: ['b1', 'b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'],
    groundColor: 0xd8c09a,
    spawnRadius: [38, 62],
    /**
     * The dune sea measured FLATTER than the arena, and it is the level whose
     * whole subject is one material: on the same pinned pose, 50% of the frame
     * inside 3° of hue and 80% inside 8°, with every one of nine regions —
     * sky, painted ranges, far dune, near rock, lit sand, shaded sand —
     * between 33.5° and 39.2°.
     *
     * The tell is the last pair. Sunlit sand 36.1° and SHADED sand 36.1°, and
     * over the whole ground band shade ran 0.114 LOWER in B/R than light.
     * Shadow that is warmer than sunlight is not a stylistic choice, it is
     * backwards: shade outdoors is lit by the sky and by nothing else — the
     * canyon, measured with the same instrument, runs +0.462. The grade was
     * doing it here, and it did not need a screenshot to see: a red lift
     * of 0.010 against a blue lift of 0.006 puts a warm floor under every dark
     * pixel, and a gain of [1.05, 1.0, 0.93] then warms what is left.
     *
     * The sky MODEL is untouched, and was checked rather than assumed: at the
     * authored 8.5 / 1.5 / 0.012 the drawn dome runs B/R 2.38 at the top-left
     * of this pose down to 1.00 at the aureole, which is a proper blue-to-white
     * gradient, and thinning it to 6.5 / 2.2 / 0.008 measured WORSE (2.38 →
     * 1.88). The blue was always there — it was the deck's warm bases and the
     * grade on top of them that buried it, and the sky region boxes that
     * measured 34° were all sitting on cloud.
     *
     * AFTER, same pose, same instrument:
     *
     *                                  before        after
     *     50% of the frame inside        3°            6°
     *     80% of the frame inside        8°          173°
     *     nine regions span            5.7°        174.7°
     *     ground band, lit vs shade   ΔB/R −0.114   ΔB/R −0.010
     *
     * Two honest caveats. The ground-band split is still very slightly the
     * wrong sign, and on THIS level that measurement is weak: the dune sea has
     * so little cast shadow in frame that its bright quartile is mostly hazed
     * distance rather than sunlit ground, so the number is reading depth as
     * much as light. And the frame's tonal range barely moved, 1.78:1 → 1.69:1
     * — the dune sea is a low-contrast subject and always will be.
     */
    atmosphere: {
      turbidity: 8.5, rayleigh: 1.5, mie: 0.012, mieG: 0.83,
      // 155° was within 6° of PARALLEL to the dune train. The height field runs
      // its dunes along (0.86, 0.51) with the slip face on the downwind side,
      // so the normal of the face that should be in shadow points along that
      // vector — and a sun at 155° raked along the crest lines instead of
      // across them, which is the one bearing that gives a dune sea no
      // modelling at all. 239° is perpendicular to the train: windward faces
      // lit, slip faces in shadow, and (because the pinned pose looks down −z)
      // the sun 59° off the view axis instead of 25°, so the sky the player is
      // looking at is the blue part of the dome rather than the aureole.
      elevation: 26, azimuth: 239,
      // `ambient` and `fillIntensity` are SMALLER KNOBS THAN THEY LOOK, and it
      // is worth writing down before someone reaches for them to deepen a
      // shadow. Metered on this block: the ground takes 3.59 of irradiance, of
      // which the hemisphere is 0.081 and the fill 0.080 — 4.5% between them.
      // The other 1.22 of the indirect is the environment probe, which is
      // derived from the sky rather than authored here (ENV_INTENSITY in
      // Engine). So a level cannot buy itself blacks from these two lines; the
      // only things that put a dark pixel in a frame made of bare sand are cast
      // shadow and the tone curve.
      sunColor: 0xfff2d6, sunIntensity: 7.2, ambient: 0.30,
      skyColor: 0xb4cdf3, groundColor: 0x8a6a44,
      // THE FILL CARRIES LUMINANCE, NOT CHROMA, and the paragraph that used to
      // sit here had the reason backwards.
      //
      // It read: "the probe is an average over the hemisphere … so neither of
      // them can model a face turning toward the open sky and getting bluer for
      // it", and on that argument the fill was made a real skylight blue
      // (0x8fb4ff B/R 3.64 → 0x7ba4ff B/R 5.05) AND stronger (0.34 → 0.48) in
      // one step. The premise is false. `getIBLIrradiance` samples the diffuse
      // convolution ALONG THE NORMAL, so the probe already carries direction,
      // and the amount is not marginal — measured on this atmosphere, probe
      // irradiance by normal:
      //
      //     toward the sun  1.287 lum, B/R 1.67      down    0.094, B/R 0.23
      //     toward open sky 0.174 lum, B/R 3.91      zenith  0.613, B/R 2.74
      //
      // Eighteen to one in luminance and seventeen to one in B/R. A face
      // turning toward the open sky was ALREADY getting bluer for it. The fill
      // was a second copy of that term, laid on at B/R 5.05 — bluer than the
      // probe's own open-sky sample (3.91) and bluer than the whole sky
      // integrated over the hemisphere (2.11). That is the term applied twice.
      //
      // The two knobs were then measured SEPARATELY, on a backlit figure, and
      // they do different jobs:
      //
      //   intensity 0 → 0.66 :  luminance σ across the silhouette 0.050 → 0.080
      //                         saturation essentially flat
      //   chroma  ×1 → ×0.3  :  saturation 0.568 → 0.318
      //                         luminance σ 0.0719 → 0.0731 (unmoved)
      //
      // So intensity buys FORM and chroma buys nothing but SATURATION. The
      // round that raised both got the first half right and the second half
      // wrong: the figure went to a flat saturated blue and its cast shadow to
      // a cyan hole. Intensity stays at 0.48. The chroma comes off.
      //
      // 0x96a5d0 is 0x7ba4ff with its chroma scaled to 0.40 about its own
      // luminance — B/R 5.05 → 2.04, and LUMINANCE IDENTICAL to four places
      // (0.3798). That matters more than it looks: `atmosphereMeter` weighs the
      // fill by lum(fillColor), so this changes the shade's colour without
      // moving the light meter, the exposure, the indirect fraction or the
      // lit-to-shade ratio by a single digit. One variable moved, and it is the
      // one the measurement indicted.
      //
      // Measured on the controlled cast shadow (tools/_shade.mjs), before →
      // after: shaded VERTICAL face saturation 0.379 → 0.143 at hue 223° → 231°,
      // shaded ground 0.402 → 0.322 at 211° → 208°, sunlit ground 0.205 → 0.212
      // (the control, which must not move), lit-to-shade 2.77:1 → 2.75:1.
      //
      // The amount is this level's own and does NOT generalise — the canyon
      // goes grey under the same edit. See its block, and the note in
      // tools/checks/lighting.mjs about the ceiling rule the data killed.
      fillColor: 0x96a5d0, fillIntensity: 0.48,
      // fogColor IS THE NEAR AIR NOW, and only that.
      //
      // The complaint against this pair was exact: 0xd0c6b4 is hue 38° and the
      // sand it hazes is hue 33°, five degrees apart, so a hundred and seventy
      // metres of desert air changed the ground by essentially nothing. Half of
      // that was the swatch and half was where distance CONVERGED — the level's
      // own `skyColor`, one colour for the whole dome, and a saturated blue on
      // the far side of neutral from the sand. Modelled on this atmosphere, the
      // ground's saturation used to fall to 0.128 by 200 m and then climb back
      // to 0.294 by 240 m at hue 226°: distance was not desaturating the desert,
      // it was re-saturating it as a different colour.
      //
      // Past 50 m the ground now walks onto the DRAWN sky in the bearing it is
      // being looked at (Terrain's uSkyStrip, resampled from ground.skyBand, the
      // same array the dome and the far ranges use). Same sweep, after:
      // 0.763 → 0.228 by 200 m, monotone the whole way, hue 26° → 24°. So this
      // swatch sets the colour of the first hundred metres of air and the sky
      // sets where everything past that goes; it is no longer free to disagree
      // with the horizon it is standing under.
      //
      // (Both sweeps are linear-radiance saturation of the level's own ground
      // swatch through the chunk's arithmetic — the same numbers the check
      // "200 m of air takes the chroma out of the ground" holds.)
      fogColor: 0xd0c6b4, fogDensity: 0.0042, exposure: 0.86, bloom: 0.36,
      saturation: 1.10, lift: [0.002, 0.005, 0.015], gain: [1.01, 1.0, 1.01],
      // Thin, scorched cloud and a long line of dune ranges receding into the
      // heat. Sparse cover on purpose — a desert sky is mostly empty, and what
      // sells the distance here is the horizon, not the clouds. Warm tops, cool
      // bases: a cumulus base never sees the sun.
      cloudCover: 0.44, cloudLit: 0xfff0d4, cloudDark: 0xa6afbc,
      cloudWindDir: 2.7, cloudWindSpeed: 0.7,
      horizonAmount: 0.85, horizonScale: 0.75, horizonColor: 0x9a7f5c,
    },
    ambience: { wind: 0.12, windFreq: 520, drone: 0.05 },
    dust: {
      count: 1300, color: 0xd8c8a8, opacity: 0.34, size: 26,
      // The dune sea is where weather belongs hardest: nothing here blocks it,
      // so a front arrives across the whole skyline at once. At the peak the
      // fog goes 0.0042 → 0.0098 (the cap — see FOG_INDOOR_LIMIT in Scenery),
      // which takes the range at which half the light survives from 198 m to
      // 85 m: the far ranges go, and the level is a different place for forty
      // seconds. The wind more than triples, which is what lays the tussock
      // flat and turns the sand sheets on.
      weather: { peak: 1.0, period: 118, duration: 44, fogGain: 3.6, windGain: 2.6, unrest: 0.16 },
    },
    // A dune sea is not bare sand, it is bare sand with dry tussock in the
    // troughs where the little water there is collects. Sparse on purpose — the
    // clump field puts it in 36 m patches, and the slope term keeps it off the
    // slip faces, so it reads as the desert having a grain rather than a lawn.
    grass: 0.40,
    grassTint: [0xb9a463, 0x7d6c3a],
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 11);

      // ── The land beyond the land, first: three dune ranges at 168/246/336 m,
      // low and long rather than craggy. The heightfield is 560 m across and the
      // camera sees 520, so without these you can see where the world stops.
      addHorizon(world, {
        seed: 4401,
        layers: [
          { radius: 168, low: 9, high: 24, shade: 0.60 },
          { radius: 246, low: 17, high: 42, shade: 0.68 },
          { radius: 336, low: 30, high: 74, shade: 0.76 },
        ],
      });

      // ── Landmarks first. Three big wrecks, spread apart so that wherever you
      // stand at least one is on your skyline and you can navigate by it. A
      // desert with nothing to steer by is where "featureless" comes from.
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 34, 78, { angle: (k / 3) * TAU + rng() * 0.6, clearance: 16, maxSlope: 0.3 });
        if (!site) continue;
        const y = site.pos.y, cx = site.pos.x, cz = site.pos.z;
        const yaw = rng() * TAU;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.3 - 0.15, yaw, rng() * 0.24 - 0.12));
        addWall(world, new THREE.Vector3(cx, y + 1.6, cz), new THREE.Vector3(11 + rng() * 6, 3.6, 2.4), q, M.hull);
        addWall(world, new THREE.Vector3(cx + Math.cos(yaw) * 6, y + 3.4, cz + Math.sin(yaw) * 6),
          new THREE.Vector3(4.5, 6.5, 1.8),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, yaw + 0.4, 0.1)), M.hull);

        // Debris falls off from where the thing broke — big pieces near, small
        // far. Scattering identical crates uniformly is the single most
        // recognisable tell of a generated level.
        cluster(world, { rmin: 0, rmax: 0, count: 14, spread: 15, falloff: 0.75,
          angle: site.a, satClearance: 1.3, maxSlope: 0.42 }, (pos, i2, d) => {
          const near = 1 - clamp(d / 15, 0, 1);
          if (rng() < near * 0.55) {
            world.addProp(makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.6 + near * 0.9));
          } else {
            const sz = 0.6 + near * 1.9;
            addRock(world, pos.clone().setY(pos.y + sz * 0.2),
              new THREE.Vector3(sz * 1.4, sz * 0.8, sz * 1.2), i2 + k * 31 + 1);
          }
        });
      }

      // ── A moisture farm: vaporators stand in surveyed LINES, not scattered.
      // One line of them says people worked here; nine random ones say nothing.
      const fa = rng() * TAU, fr = 26 + rng() * 34;
      const fx = Math.cos(fa) * fr, fz = Math.sin(fa) * fr;
      const dir = fa + Math.PI * 0.5;
      run(world,
        { x: fx - Math.cos(dir) * 26, z: fz - Math.sin(dir) * 26 },
        { x: fx + Math.cos(dir) * 26, z: fz + Math.sin(dir) * 26 },
        6, (pos) => world.addProp(makeVaporator(world, pos.clone().setY(pos.y + 1.3))),
        { jitter: 3.5, clearance: 5, maxSlope: 0.3 });
      // and the clutter of working them
      cluster(world, { rmin: 0, rmax: 0, count: 9, spread: 9, angle: fa,
        satClearance: 1.2 }, (pos) => {
        if (rng() < 0.5) world.addProp(makeBarrel(world, pos.clone().setY(pos.y + 0.55)));
        else world.addProp(makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.7));
      });

      // ── Rock. Outcrops come in groups along a fault, with scree trailing off
      // downslope — not as evenly spaced lumps. Eight groups, not five, and out
      // to 155 m rather than 92: the old range stopped at the edge of the fight,
      // which is precisely why everything past it measured as empty. Capped at
      // eight because `addRock` is ONE DRAW CALL PER ROCK — the instanced pass
      // below is what actually fills the map, this is what gives it shape.
      for (let g = 0; g < 8; g++) {
        cluster(world, { rmin: 18, rmax: 155, count: 8, spread: 12, falloff: 0.6,
          satClearance: 2.0, maxSlope: 0.5, tries: 20 }, (pos, i2, d) => {
          const sz = lerp(2.6, 0.5, clamp(d / 12, 0, 1)) * (0.75 + rng() * 0.5);
          addRock(world, pos.clone().setY(pos.y + sz * 0.22),
            new THREE.Vector3(sz * 1.5, sz * 1.0, sz * 1.3), g * 17 + i2 + 1);
        });
      }

      // ── The floor itself. See strewGround: this is the pass that takes the
      // dune sea from "55% of it has nothing within 12 m" to something you can
      // stand anywhere on and see the ground has a history.
      strewGround(world, {
        seed: 3301, radius: 150, inner: 5, landmarks: 1.3,
        // The dune sea spreads its grades over a 150 m disc against the
        // arena's 108, so the same counts are half the areal density inside
        // the ground the player actually walks. It also carries the thinnest
        // cover of the three, so the stone has to do more of the work here.
        spread: 0.36, boulders: 1.5, cobble: 1.7,
      });

      // ── Wrecks in the middle distance. A desert collects them, and each one
      // is a silhouette to steer by from a long way off.
      strewWrecks(world, { count: 5, rmin: 60, rmax: 165, seed: 2610 });

      // ── Two masts on the skyline. Verticals read at range where a horizontal
      // does not, and a desert with nothing standing up in it has no scale.
      for (let k = 0; k < 2; k++) {
        const site = findSite(world, 90, 175, { clearance: 14, maxSlope: 0.28, tries: 24 });
        if (site) addAntenna(world, site.pos, { height: 15 + rng() * 9, seed: 2700 + k });
      }

      // ── Loose cover near the fight, and dead scrub between it and the rim so
      // there is no band of ground with nothing on it at all.
      for (let i = 0; i < 10; i++) {
        const site = findSite(world, 14, 46, { bias: 0.7, clearance: 4 });
        if (site) world.addProp(makeCrate(world, site.pos.clone().setY(site.pos.y + 0.45), 0.85));
      }
      /* Broken rock in the middle distance, where the eye needs something to
       * land on between the fight and the ranges. Real boulder geometry rather
       * than scree chips, because at 30–120 m the facets still read.
       *
       * Through the DRIFT rather than `findSite`, and it is worth saying why
       * on the one call where the difference is easiest to see: nine clusters
       * placed uniformly over a 150 m disc are nine things, one every 2,600 m²,
       * each one alone. Nine placed through the level's own stone field arrive
       * in twos and threes on the ground that already carries talus, and leave
       * the ground that carries tussock clear. Same nine clusters, same cost. */
      drift(world, {
        field: stoneField(world), rmin: 30, rmax: 150, count: 9,
        clearance: 9, maxSlope: 0.5, tries: 22,
      }, (pos, k) => addBoulderCluster(world, pos, {
        radius: 9, count: 11, size: 1.7, seed: 4500 + k,
      }));
    },
  },

  arena: {
    name: 'The Execution Arena',
    blurb: 'A bowl of sand ringed by stone. Nowhere to run, and something large is waking up.',
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
    grass: 0.36,
    grassTint: [0xa9985c, 0x6f6234],
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

      // ── The ring. Still a ring — it is what makes the arena an arena — but
      // built as ARCHITECTURE rather than 44 identical slabs: a colonnade on a
      // stepped stylobate, with tiers of seating behind it, broken open where
      // the horde comes through. Evenly spaced identical boxes is the single
      // clearest tell that nobody designed the space.
      const R = 56, bays = 36;
      const gates = [0.7, 0.7 + TAU / 4, 0.7 + TAU / 2, 0.7 + TAU * 0.75];
      const nearGate = (a) => gates.some(g => {
        let d = Math.abs(((a - g + Math.PI) % TAU + TAU) % TAU - Math.PI);
        return d < 0.10;
      });

      for (let i = 0; i < bays; i++) {
        const a = (i / bays) * TAU;
        if (nearGate(a)) continue;
        const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
        const yaw = -a + Math.PI / 2;
        // Every fourth bay has fallen. A wall that is uniformly intact reads as
        // a texture; one that fails in places reads as having a history.
        const fallen = (i * 7 + 3) % 9 < 2;
        // NB: addBrokenWall takes its dimensions as a Vector3 THIRD argument,
        // not as fields on the options object. Passing an options object here
        // makes every dimension undefined, which propagates NaN into the rebar
        // curve and throws out of the whole dressing pass.
        addBrokenWall(world, at(cx, cz),
          V(9.4, fallen ? 3.2 + rng() * 1.6 : 8.4, 2.1),
          { yaw, seed: 400 + i, mat: M.duracrete, ruin: fallen ? 0.75 : 0.28 });
        // colonnade standing in front of the wall, some columns snapped
        if (i % 2 === 0) {
          const ix = Math.cos(a) * (R - 5.5), iz = Math.sin(a) * (R - 5.5);
          addColumn(world, at(ix, iz), {
            height: 7.5, radius: 0.55, yaw, seed: 500 + i,
            standing: fallen ? 0.35 + rng() * 0.3 : 1,
            mat: M.sandstone,
          });
        }
      }

      // ── Four gates the horde walks out of, framed properly.
      for (let g = 0; g < gates.length; g++) {
        const a = gates[g];
        const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
        addArch(world, at(cx, cz), {
          span: 7.5, rise: 5.4, thickness: 2.2, yaw: -a + Math.PI / 2,
          seed: 600 + g, mat: M.duracrete, broken: g === 2,
        });
      }

      // ── The landmark. An execution arena has something at its focus, and a
      // toppled colossus gives the space a story and the fight a centrepiece to
      // circle. Off-centre so the middle stays clear to fight in.
      addColossus(world, at(-14, 11, 0), { height: 17, yaw: 2.1, seed: 707, ruined: true });
      addDebrisField(world, at(-14, 11), { radius: 11, seed: 708, count: 26 });

      // ── The execution pillars themselves — the reason the place has a name.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.4;
        const cx = Math.cos(a) * 9.5, cz = Math.sin(a) * 9.5;
        addColumn(world, at(cx, cz), {
          height: 6.4, radius: 0.42, seed: 800 + i, mat: M.sandstone,
          standing: i === 1 ? 0.55 : 1,
        });
        siteOk(world, cx, cz, { clearance: 4, spawnClear: 0 });
      }

      // ── Rock spilling in through the broken bays, and the debris of a place
      // that has been fought in before.
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 30, 50, { clearance: 9, maxSlope: 0.5 });
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
          ? makeBarrel(world, site.pos.clone().setY(site.pos.y + 0.55))
          : makeCrate(world, site.pos.clone().setY(site.pos.y + 0.45), 0.75));
      }

      // ── The sand of the bowl itself. Nothing here takes a collider, because
      // this is the floor of the fight and a shin-high rock you cannot see past
      // your own blade is worse than bare ground. Purely what the eye reads.
      strewGround(world, { seed: 3302, radius: 108, inner: 4, boulders: 0.85 });

      // ── Rubble banked against the foot of the ring, where thirty-six bays'
      // worth of fallen masonry would actually be. A wall standing on clean
      // sand is a wall that was put there this morning. Five arcs of it rather
      // than one per bay: each covers 72° of the circumference, and five
      // instanced calls buy what thirty-six would have cost in draw calls.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.21;
        addScree(world, at(Math.cos(a) * (R - 4) * 0.62, Math.sin(a) * (R - 4) * 0.62),
          { radius: R - 2, inner: R * 0.62, count: 430, size: 0.62, seed: 3400 + i,
            // banked where the bays actually fell in, not evenly round the ring
            field: stoneField(world) });
      }

      // ── Fallen columns and broken plinths lying in the sand across the bowl.
      // Horizontal masonry at ground level is exactly the size band the floor
      // was missing: too big to be litter, too small to be architecture.
      for (let k = 0; k < 7; k++) {
        const site = findSite(world, 20, 50, { clearance: 6, maxSlope: 0.4, tries: 20 });
        if (!site) continue;
        // `standing` below about 0.4 is a stump with its shaft lying beside it
        addColumn(world, site.pos, {
          height: 5.4 + rng() * 2.4, radius: 0.42 + rng() * 0.18,
          yaw: rng() * TAU, seed: 3500 + k, standing: 0.14 + rng() * 0.22,
          mat: M.sandstone,
        });
      }
      for (let k = 0; k < 2; k++) {
        const site = findSite(world, 24, 52, { clearance: 7, maxSlope: 0.35, tries: 20 });
        if (site) addPlinth(world, site.pos, { width: 2.6 + rng() * 1.6, height: 1.1 + rng() * 0.7, seed: 3600 + k });
      }

      // ── And outside the ring: the ground the horde walks in over. It was
      // completely bare, which is what you saw through every broken bay.
      strewGround(world, { seed: 3303, radius: 165, inner: 62, boulders: 1.1, grit: 0.3 });
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
        const site = findSite(world, 66, 168, { clearance: 11, maxSlope: 0.5, tries: 20 });
        if (site) addBoulderCluster(world, site.pos, { radius: 9, count: 11, size: 1.5, seed: 4600 + k });
      }
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 80, 170, { clearance: 16, maxSlope: 0.55, tries: 24 });
        if (site) addOutcrop(world, site.pos, { size: 7 + rng() * 5, seed: 3800 + k });
      }
    },
  },

  hangar: {
    name: 'Hangar Bay Nine',
    blurb: 'Industrial light, cover everywhere, and a blast door between you and the way out.',
    terrain: 'hangar',
    pool: ['b1', 'trooper', 'b2', 'droideka', 'acolyte', 'sniper'],
    groundColor: 0x8a8f98,
    spawnRadius: [24, 44],
    atmosphere: {
      sky: false, bgColor: 0x0a0d13, fog: true, fogColor: 0x141922, fogDensity: 0.016,
      sunColor: 0xbcd0ff, sunIntensity: 3.4, ambient: 0.26,
      skyColor: 0x5f7398, groundColor: 0x232830, elevation: 62, azimuth: 40,
      fillColor: 0xffb070, fillIntensity: 0.6,
      exposure: 1.15, bloom: 0.55, saturation: 1.0,
      lift: [0.006, 0.008, 0.014], gain: [0.98, 1.0, 1.06],
      clouds: false, horizon: false,   // interior — there is no sky to dress
    },
    ambience: { wind: 0.03, windFreq: 180, drone: 0.16 },
    dust: { count: 500, color: 0xa8b4c8, opacity: 0.16, size: 16 },
    grass: 0,
    dress(world) {
      const M = propMaterials();
      const T = world.terrain;
      const H = 12;
      // outer shell
      for (const [x, z, sx, sz] of [[0, -46, 100, 2.4], [0, 46, 100, 2.4], [-46, 0, 2.4, 92], [46, 0, 2.4, 92]]) {
        addWall(world, new THREE.Vector3(x, H / 2, z), new THREE.Vector3(sx, H, sz), new THREE.Quaternion(), M.hull);
      }
      // roof trusses + lights
      for (let i = -4; i <= 4; i++) {
        addWall(world, new THREE.Vector3(0, H - 0.6, i * 10), new THREE.Vector3(92, 0.9, 1.1), new THREE.Quaternion(), M.darkSteel);
        const lamp = new THREE.PointLight(0xcfe4ff, 26, 34, 2);
        lamp.position.set((i % 2 ? -14 : 14), H - 1.6, i * 10);
        world.scene.add(lamp);
        world.levelLights.push(lamp);
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.0),
          new THREE.MeshStandardMaterial({ color: 0x0e1116, emissive: 0xbcd8ff, emissiveIntensity: 3.4, roughness: 0.4 }));
        fixture.position.copy(lamp.position);
        world.scene.add(fixture);
        world.statics.push(fixture);
      }
      // ── The interior. A hangar is a WORKSHOP: bays down the sides, an
      // aisle down the middle to the door, and the clutter of people who work
      // there. Sixteen randomly-rotated concrete blocks scattered over the
      // floor is what a generated level looks like, not what a hangar does.
      beginDressing(world, 20250805 + 37);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      // service gantries along both long walls, with the pipework they carry
      for (const side of [-1, 1]) {
        addGantry(world, V(side * 34, 0, -14), { length: 30, height: 5.4, yaw: Math.PI / 2, seed: 1700 + side });
        // NB: addPipeRun takes an ARRAY of points, not two endpoints — it is a
        // run through a polyline, not a segment.
        addPipeRun(world, [
          V(side * 41, 6.6, -34), V(side * 41, 6.6, -8),
          V(side * 41, 7.4, 8), V(side * 41, 7.4, 34),
        ], { radius: 0.34, seed: 1710 + side });
        addCableRun(world, V(side * 39, 8.2, -20), V(side * 39, 7.4, 12), { seed: 1720 + side, sag: 1.4 });
      }

      // working bays down each side: scaffold, crate stacks, a tarp, a console
      for (let b = 0; b < 6; b++) {
        const side = b % 2 ? 1 : -1;
        const z = -34 + Math.floor(b / 2) * 24 + rng() * 6;
        const x = side * (22 + rng() * 6);
        if (!siteOk(world, x, z, { clearance: 8, spawnClear: 10 })) continue;
        const yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (rng() < 0.5) addScaffold(world, at(x, z), { width: 4.5, depth: 2.2, lifts: 2, seed: 1800 + b });
        else addCrateStack(world, at(x, z), { seed: 1810 + b, height: 3 });
        world.addProp(makeConsole(world, at(x - side * 4, z + 3, 0.5)));
        // low cover in front of the bay — this is what you actually fight behind
        addWall(world, at(x - side * 7, z - 4, 1.1), V(5.5, 2.2, 1.4),
          new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), M.duracrete);
      }

      // a wrecked hull being worked on, the reason the bay exists
      addHullSection(world, at(-8, 20), { length: 22, radius: 3.8, yaw: 0.3, seed: 1900 });
      addDebrisField(world, at(-8, 20), { radius: 10, seed: 1910, count: 22 });
      addTarp(world, at(6, 16), { width: 5, depth: 4, seed: 1920 });

      // loose clutter, clustered around the bays rather than sprinkled evenly
      for (let k = 0; k < 6; k++) {
        cluster(world, { rmin: 12, rmax: 40, count: 7, spread: 5, satClearance: 1.3, spawnClear: 10 },
          (pos) => {
            world.addProp(rng() < 0.28
              ? makeBarrel(world, pos.clone().setY(pos.y + 0.55))
              : makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.8));
          });
      }
      // and the aisle to the door stays clear, so the fight has a spine
      for (let i = 0; i < 8; i++) {
        const site = findSite(world, 14, 40, { clearance: 3, spawnClear: 11 });
        if (site && Math.abs(site.pos.x) > 7) {
          world.addProp(makeCrate(world, site.pos.clone().setY(site.pos.y + 0.45), 0.8));
        }
      }
      // THE blast door
      const door = new BlastDoor(world, {
        position: new THREE.Vector3(0, 2.6, -44.4),
        width: 6.2, height: 5.2, thickness: 0.62,
        onBreach: () => {
          world.notify('BREACHED', 'the way out is open');
          world.player?.addFlow(0.5);
          world.score += 2500;
        },
      });
      world.doors.push(door);
      world.notify('HANGAR BAY NINE', 'the door will not open for you — cut it');
    },
  },

  canyon: {
    name: 'The Wash',
    blurb: 'A river cut through red rock. Water underfoot, cover in the walls.',
    terrain: 'canyon',
    pool: ['b1', 'trooper', 'b2', 'sniper', 'acolyte', 'droideka', 'beast'],
    groundColor: 0xb09578,
    spawnRadius: [32, 58],
    water: { level: 0.35, shallow: 0x3f8fa6, deep: 0x123448 },
    atmosphere: {
      turbidity: 4.5, rayleigh: 3.0, mie: 0.006, mieG: 0.78,
      elevation: 14, azimuth: 95,
      sunColor: 0xffd9a8, sunIntensity: 6.4, ambient: 0.32,
      skyColor: 0xa8c8f0, groundColor: 0x6a5440,
      // This level never authored a fill and took the engine's pale default,
      // which is the one thing about its light that was not deliberate. It is
      // DIMMER than the other two on purpose at 0.40: a 14° sun already leaves
      // this level with more sky in its shade than either of them (see
      // diffuseCap), so it needs the hue from this term and none of the level.
      // Measured on a controlled cast shadow (tools/_shade.mjs), this level's
      // shaded sand went hue 79.0° / saturation 0.013 — grey, with GREEN as its
      // maximum channel — to hue 205.3° / 0.354 with blue as its maximum. That
      // is the fix that worked and it stays.
      //
      // THIS LEVEL KEEPS 0x7ba4ff AND THAT IS A MEASURED DECISION, not an
      // oversight, so nobody "finishes the job" later.
      //
      // The arena and the dune sea had their fills desaturated because their
      // shaded faces were reading as a blue filter (saturation 0.320 and 0.379
      // against sunlit 0.316 and 0.171 — a shaded face as colourful as a lit
      // one). It is tempting to apply the same correction here for consistency,
      // and it was applied here, and it broke this level. Measured on the same
      // controlled cast shadow, with this level's fill taken to B/R 2.58:
      //
      //     shaded vertical face   saturation 0.148 → 0.020, hue 224.5° → 294.9°
      //
      // That is grey with a meaningless hue — the exact "green-grey mud" this
      // level was rescued from a round ago, walked straight back into. The
      // reason is that this level's shade is not made of the same stuff: at a
      // 14° sun the probe is 94.6% of the shade on a face turned to the camera
      // where the other two levels are 48–55%, and its exposure of 1.78 puts
      // its shade at display luminance 0.31 where ACES has already begun taking
      // chroma out, against 0.20 on the arena where it has not. Same edit, two
      // and a half times the effect.
      //
      // So the correction is per level and this level's correct amount is zero.
      // The three outdoor levels now carry three different fills, which is the
      // point: one constant across three skies is what produced the fault.
      fillColor: 0x7ba4ff, fillIntensity: 0.40,
      fogColor: 0xb4a894, fogDensity: 0.0052, exposure: 0.94, bloom: 0.42,
      saturation: 1.1, lift: [0.008, 0.010, 0.014], gain: [1.03, 1.0, 0.98],
      // A 14-degree sun under heavy cloud: the light rakes along the canyon and
      // the cloud base catches it. This is the level that should look like
      // weather is happening.
      cloudCover: 0.74, cloudLit: 0xffd9b4, cloudDark: 0x6f7488,
      cloudWindDir: 0.35, cloudWindSpeed: 1.5,
      horizonAmount: 1.4, horizonScale: 1.6, horizonColor: 0x5e5347,
    },
    ambience: { wind: 0.09, windFreq: 300, drone: 0.08 },
    dust: {
      count: 700, color: 0xc8bca8, opacity: 0.2, size: 18,
      // A gorge funnels weather rather than sheltering from it: the fronts are
      // narrower and come more often, and what they carry is river haze rather
      // than sand — so the fog gain is high and the wind gain is not.
      weather: { peak: 0.78, period: 96, duration: 36, fogGain: 3.4, windGain: 1.6, unrest: 0.24 },
    },
    grass: 1.0,
    grassTint: [0x8a9a58, 0x4d5c2e],
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world, 20250805 + 53);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const at = (x, z, dy = 0) => V(x, T.height(x, z) + dy, z);

      // ── The rim country, beyond the gorge. Tall: the whole read of a canyon
      // is that you are DOWN in something, and that only works if there is
      // higher ground behind the walls at more than one distance.
      addHorizon(world, {
        seed: 4403,
        layers: [
          { radius: 182, low: 26, high: 52, shade: 0.48 },
          { radius: 262, low: 40, high: 82, shade: 0.56 },
          { radius: 352, low: 58, high: 124, shade: 0.66 },
        ],
      });

      // The canyon runs roughly along x, with a water course down the middle.
      // Everything here is placed relative to that axis rather than sprinkled
      // over a rectangle, because a canyon is a CORRIDOR and its dressing
      // should read as things the water and the walls put where they are.
      const wet = world.level?.water?.level ?? 0.35;

      // ── A rock arch spanning the gorge. One landmark you can see from a long
      // way down the canyon and navigate by.
      const archSite = findSite(world, 20, 55, { clearance: 16, maxSlope: 0.6 });
      if (archSite) addRockArch(world, archSite.pos, { span: 15, height: 11, seed: 1201 });

      // ── Outcrops shed from the walls, with scree fanning out below them.
      // Real talus sits at the foot of the slope it fell off, not in midfield.
      for (let k = 0; k < 7; k++) {
        const x = (rng() - 0.5) * 165;
        const side = rng() < 0.5 ? -1 : 1;
        const z = side * (24 + rng() * 20);
        if (!siteOk(world, x, z, { clearance: 10, maxSlope: 0.85 })) continue;
        const pos = at(x, z);
        addOutcrop(world, pos, { size: 4 + rng() * 4, seed: 1300 + k });
        // the fan runs downslope, toward the channel
        addScree(world, at(x, z - side * 5), { radius: 10, count: 110, seed: 1310 + k });
      }
      for (let k = 0; k < 5; k++) {
        const site = findSite(world, 14, 80, { clearance: 8, maxSlope: 0.7 });
        if (site) addBoulderCluster(world, site.pos, { radius: 6, count: 7, seed: 1400 + k });
      }

      // ── Spires on the high ground only. They read as erosion remnants, and
      // a remnant standing in the middle of the wash makes no sense.
      for (let i = 0; i < 12; i++) {
        const x = (rng() - 0.5) * 150, z = (rng() - 0.5) * 78;
        const y = T.height(x, z);
        if (y < wet + 2.5) continue;
        if (!siteOk(world, x, z, { clearance: 6, maxSlope: 0.8 })) continue;
        world.addProp(makeSpire(world, V(x, y + 3, z), 5 + rng() * 4));
      }

      // ── Somebody camped in the gorge: a small outpost on a dry bench, and a
      // scatter of what they left, clustered around it rather than everywhere.
      const camp = findSite(world, 25, 65, { clearance: 16, maxSlope: 0.3, minHeight: wet + 0.9 });
      if (camp) {
        addOutpost(world, camp.pos, { radius: 10, seed: 1500, yaw: rng() * TAU });
        cluster(world, { rmin: 0, rmax: 0, count: 10, spread: 12, angle: camp.a,
          satClearance: 1.6, minHeight: wet + 0.5 }, (pos) => {
          if (rng() < 0.35) world.addProp(makeBarrel(world, pos.clone().setY(pos.y + 0.55)));
          else world.addProp(makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.8));
        });
        // NB: addCableRun takes TWO endpoints, not a position and options.
        addCableRun(world,
          at(camp.pos.x - 5, camp.pos.z - 3, 3.4),
          at(camp.pos.x + 6, camp.pos.z + 4, 2.6), { seed: 1510, sag: 0.9 });
      }

      // ── Wreckage half in the water, because a canyon collects what washes
      // down it. This is the cover you actually fight around.
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 18, 70, { clearance: 12, maxSlope: 0.45 });
        if (!site) continue;
        addHullSection(world, site.pos, {
          length: 16 + rng() * 10, radius: 3.4, yaw: rng() * TAU, seed: 1600 + k,
        });
        addDebrisField(world, site.pos, { radius: 9, seed: 1610 + k, count: 20 });
      }

      // ── Loose cover on the dry benches only.
      for (let i = 0; i < 14; i++) {
        const site = findSite(world, 10, 75, { clearance: 3, minHeight: wet + 0.4, maxSlope: 0.35 });
        if (!site) continue;
        world.addProp(rng() < 0.3
          ? makeBarrel(world, site.pos.clone().setY(site.pos.y + 0.55))
          : makeCrate(world, site.pos.clone().setY(site.pos.y + 0.45), 0.8));
      }

      // ── The bed of the wash. A river bed is the single most cluttered
      // surface in any landscape — everything upstream ends up on it, graded by
      // size — and this one was the emptiest floor in the game at 37% of it
      // with nothing within 12 m. Three grain sizes, laid along the channel
      // rather than on a disc, because the water sorted them that way.
      /* `addScree` beds its chips on the heightfield with no slope test, which
       * looked like a problem here: a screenshot showed stones apparently
       * pasted onto a wall. Measured, it is not — nothing inside 90 m of the
       * wash is steeper than 0.75 (41°) and the steepest BAND, |z| 24-36 m,
       * averages 0.30, which is 29°. Stones lying at 29° in a gorge are talus,
       * and talus is what should be there. Pulling this disc in to 74 m to
       * "fix" it took the fraction of walkable ground with nothing within 12 m
       * from 0.6% straight back to 14.5%, which is the actual cost of acting
       * on a screenshot instead of a number. */
      strewGround(world, { seed: 3310, radius: 118, boulders: 1.1, cobble: 1.4, grit: 1.0,
        landmarks: 1.4, mat: M.stone });
      // Along the CHANNEL rather than on a disc. Kept inside |z| < 50 so a band
      // reaches the FOOT of a wall, where talus belongs, and not up its face.
      for (let k = 0; k < 8; k++) {
        const cx = (k - 3.5) * 26;
        addScree(world, at(cx, (rng() - 0.5) * 22),
          { radius: 30, count: 340, size: 0.72, seed: 3900 + k, mat: M.stone,
            // a river bed is graded into BARS with clean channel between them
            field: stoneField(world) });
      }

      // ── Boulders shed off both walls, all the way down the gorge. Seven
      // outcrops was one every 24 m of a 165 m canyon; this is the talus that
      // should be lying between them.
      for (let k = 0; k < 8; k++) {
        const x = (rng() - 0.5) * 180;
        const side = rng() < 0.5 ? -1 : 1;
        const z = side * (14 + rng() * 32);
        if (!siteOk(world, x, z, { clearance: 7, maxSlope: 0.9 })) continue;
        addBoulderCluster(world, at(x, z), { radius: 8, count: 12, size: 1.45, seed: 4000 + k });
      }

      // ── Driftwood and wreck plate stranded along the high-water line. This
      // is the band the eye follows down a canyon, and it was bare.
      for (let k = 0; k < 12; k++) {
        const x = (rng() - 0.5) * 185;
        const side = rng() < 0.5 ? -1 : 1;
        const z = side * (5 + rng() * 13);
        const y = T.height(x, z);
        if (y < wet - 0.2 || y > wet + 1.8) continue;
        if (!siteOk(world, x, z, { clearance: 3.4, maxSlope: 0.5 })) continue;
        const yaw = rng() * TAU;
        // flat and low, lying with the current rather than standing in it
        addWall(world, V(x, y + 0.22, z),
          new THREE.Vector3(2.4 + rng() * 4.5, 0.4 + rng() * 0.4, 0.7 + rng() * 1.1),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, yaw, (rng() - 0.5) * 0.4)),
          rng() < 0.5 ? M.hull : M.wood);
      }
      // the shingle bank the strandline sits on, as two wide passes rather than
      // one per piece of driftwood
      for (let k = 0; k < 2; k++) {
        addScree(world, at((rng() - 0.5) * 120, (k ? 1 : -1) * (9 + rng() * 8)),
          { radius: 58, count: 480, size: 0.34, seed: 4100 + k, mat: M.stone,
            field: stoneField(world) });
      }

      // ── More spires, and a second rock arch further down: navigating a
      // corridor needs landmarks along it, not one at the middle.
      for (let i = 0; i < 14; i++) {
        const x = (rng() - 0.5) * 190, z = (rng() - 0.5) * 96;
        const y = T.height(x, z);
        if (y < wet + 2.5) continue;
        if (!siteOk(world, x, z, { clearance: 6, maxSlope: 0.85 })) continue;
        world.addProp(makeSpire(world, V(x, y + 3, z), 4 + rng() * 5));
      }
      const arch2 = findSite(world, 60, 130, { clearance: 18, maxSlope: 0.7, tries: 22 });
      if (arch2) addRockArch(world, arch2.pos, { span: 19, height: 14, seed: 4200 });
      for (let k = 0; k < 4; k++) {
        const site = findSite(world, 70, 160, { clearance: 16, maxSlope: 0.8, tries: 24 });
        if (site) addOutcrop(world, site.pos, { size: 6.5 + rng() * 6, seed: 4300 + k });
      }
    },
  },
};

export const LEVEL_ORDER = ['dojo', 'dunes', 'arena', 'hangar', 'canyon'];
