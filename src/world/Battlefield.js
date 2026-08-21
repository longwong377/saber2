/**
 * BATTLEFRONT BORZ — GENERATE THE BATTLE, THEN THE GROUND THAT EXPLAINS IT.
 *
 * `FLAGSHIP.md` §12, items 1 to 3. Item 4 — the dressing — was built first and
 * lives in `src/world/Front.js` and `src/world/Fallen.js`; it dresses a front
 * that until now had no ground under it. `Front.frontAt` is a bearing and a
 * distance, i.e. §12.2's bezier collapsed to its degenerate straight case, and
 * every level it has ever dressed was an authored heightfield that knew nothing
 * about the line drawn across it. This file is the missing half: the battle is
 * decided first, and the ground is derived from it.
 *
 *   1. A REASON, from a table of five. `REASONS` below.
 *   2. THE FRONT, before the ground. A cubic bezier from one map edge to
 *      another, laid down by six numbers.
 *   3. THE HEIGHT FUNCTION DERIVES FROM THE FRONT. `makeBattlefield().height`
 *      is a closure of exactly the shape `Terrain` already calls, so it slots
 *      into a preset row with ZERO Terrain changes — the constructor reads
 *      `preset.height(x, z)` and nothing else about the shape.
 *   5. DO NOT GENERATE THE PALETTE. `battlefieldGround` spreads an AUTHORED
 *      preset row and overwrites one field. Every colour, every band, the
 *      loose layer, the wind, the maps key and `rockAt` are the authored
 *      ground's own, unread and uncopied. See the note over that function.
 *
 * ── WHAT THIS IS TO §13.5, WHICH IS THE CONSTRAINT THAT BINDS IT ────────
 *
 * "No room's deletion deletes the mode — every level in `LEVEL_ORDER` is a
 * legal seed." THE LINE rolls its ground off the run seed across all seven
 * authored theatres (`Session.rollGround`, `Levels.theatreFor`).
 *
 * **This is a LAYER, not an eighth seed.** A generated ground here is an
 * authored ground with its `height` replaced and everything else borrowed: it
 * cannot exist without a base row, it is named after the row it borrowed
 * (`front:geonosis`), and it is never in `LEVELS` or `LEVEL_ORDER`, so the roll
 * cannot land on it and no authored ground becomes unreachable by its
 * existence. That is the whole argument for the choice: an eighth entry in the
 * roster would make the generated ground a 1-in-8 draw AND would put a ground
 * nobody authored in front of a player who rolled it, and the failure mode of
 * generated terrain is not that it is bad once — it is that it is bad on a
 * seed you cannot delete. A layer degrades to the authored ground by not being
 * asked for. A seed does not degrade at all.
 *
 * `installGround` is the only door into `TERRAIN_PRESETS`, and it REFUSES to
 * overwrite a name the table already holds. §13.5 is a property of a table,
 * and this file is the one that could break it, so the guard is here rather
 * than only in a check.
 *
 * ── WHAT IS NOT HERE, SAID PLAINLY ──────────────────────────────────────
 *
 * NOTHING IN THE GAME CALLS THIS YET. Same standing as `Front.js`, which says
 * the same thing at the top of itself: no mode builds a generated ground and
 * no level names one. The door is two lines —
 *
 *     const g = battlefieldGround('geonosis', world.runSeed);
 *     installGround(g.key, g.preset);   // then load a level whose terrain is g.key
 *
 * — and the third line is the one that is not written: `World.loadLevel`
 * builds its `Terrain` from `LEVELS[key].terrain`, so a mode that wants this
 * needs a level row pointing at the installed key, and a level row is a thing
 * §13.5 has opinions about. That decision belongs to whoever wires the mode,
 * not to the generator, and making it here would be making it for them.
 *
 * What IS wired is the measurement: `tools/checks/battlefield.mjs` builds a
 * real `Terrain` off a generated preset and holds every clause of §12.3 to a
 * number, so the ground is known to be right before anything stands on it.
 */

import { makeRng, clamp, lerp, smoothstep, fbm2, ridged2 } from '../engine/MathUtil.js';
import { TERRAIN_PRESETS } from './Terrain.js';

/**
 * ── 1. THE REASON THERE IS A BATTLE HERE ────────────────────────────────
 *
 * §12.1, verbatim: *"A reason, from a table of five — a pass, a ford, a
 * landing zone, a gun line, a wreck field. One seeded choice, not a continuous
 * parameter space. That is how you avoid slop."*
 *
 * So the seed picks a ROW, and the row is a set of numbers a person wrote. A
 * generator that rolled `crest ∈ [12, 38]` and `standoff ∈ [30, 120]`
 * independently would reach every row below and ten thousand grounds between
 * them, and the ones between them are the slop: a 22 m rise at 74 m standoff
 * with a 71 m gap is not a pass, a ford or anything else — it is the average
 * of five ideas, which is the shape procedural ground fails as.
 *
 * Every field is metres or a ratio, and every one of them is read by
 * `makeBattlefield` below:
 *
 *   standoff  [near, far]  how far back the high ground stands from the line,
 *             on each side of it. NEVER zero — §12.3's "high ground flanks the
 *             front and never sits on it" is this number being positive, and
 *             it is the reason the property is a construction rather than a
 *             hope. The two entries differ where the battle is asymmetric.
 *   rise      over how many further metres the flank climbs to full crest.
 *   crest     [near, far]  metres of ridge amplitude on each side. A zero is
 *             legal and means one side is open ground — that is what a landing
 *             zone IS.
 *   gap       the chokepoint's half-width in metres OF ARC ALONG THE LINE.
 *   grain     [along, across] the ridge field's wavelengths in the advance
 *             frame. along > across is §12.3's anisotropy and the ratio is how
 *             hard the ground "moves in a direction".
 *   swale     metres the corridor is cut BELOW the surrounding plain, along
 *             the line itself. A crossing is a low place; a pass is not.
 *   swell     the isotropic base relief, metres. Nothing to do with the front,
 *             and it has to be there: ground with no relief except the battle's
 *             reads as a diagram of a battle.
 */
export const REASONS = {
  /** A PASS. Steep shoulders close in on both sides, one narrow way through.
   *  The tightest gap on the table and the tallest crest: everything about this
   *  row says "there is one way across and both armies know it". */
  pass: { standoff: [38, 42], rise: 52, crest: [37, 33], gap: 42,
    grain: [215, 56], swale: 0.8, swell: 2.0 },
  /** A FORD. The line lies in a broad shallow crossing — low banks a long way
   *  back, and the corridor itself CUT rather than merely clear, which is the
   *  only row where the front is the lowest ground on the map. */
  ford: { standoff: [58, 62], rise: 74, crest: [17, 15], gap: 92,
    grain: [178, 62], swale: 3.6, swell: 1.5 },
  /** A LANDING ZONE. One side is open flat ground — that is what a LZ is, and
   *  it is why `crest` takes a zero at all. The other side is the ridge the
   *  people already here are holding. */
  landing: { standoff: [46, 92], rise: 44, crest: [31, 0], gap: 64,
    grain: [230, 60], swale: 0.4, swell: 1.8 },
  /** A GUN LINE. A long glacis on one side rising to guns set well back — the
   *  biggest standoff on the table, because a gun line that is 40 m from the
   *  fighting is not a gun line, it is a skirmish. */
  gunline: { standoff: [118, 44], rise: 88, crest: [27, 13], gap: 56,
    grain: [262, 68], swale: 0.6, swell: 2.4 },
  /** A WRECK FIELD. Low broken ground either side and a wide loose gap: this
   *  is the row where the reason to fight here is not the shape of the ground
   *  at all, so the ground gets out of the way and §12.4's wrecks are the
   *  content. */
  wreckfield: { standoff: [44, 46], rise: 38, crest: [16, 18], gap: 108,
    grain: [148, 70], swale: 0.5, swell: 3.0 },
};

/**
 * HOW MUCH OF THE FLANK IS UPLAND AND HOW MUCH IS RIDGE.
 *
 * THIS NUMBER IS WHAT MAKES "EXACTLY ONE CHOKEPOINT" TRUE, and the first
 * version did not have it. `ridged2` returns to near zero in its valleys, so a
 * flank built as `crest × ridge` is not a wall — it is a row of hills with a
 * draw between every pair of them, and the draws run TOWARD the line because
 * that is what §12.3's anisotropy asks for. Measured on the built heightfield
 * that way: the crossing-barrier profile of a landing zone had its deep notch
 * at the choke and five more places along the line where the climb fell under
 * a third of the median, i.e. six ways through a wall that is supposed to have
 * one. §12.3 says two reads as a maze.
 *
 * So the flank is an UPLAND with ridges on it: 45% of the crest is a plateau
 * the ridge field rides on, and the noise spends the other 55%. The variogram
 * is untouched by this — adding a constant to a field cannot change the
 * differences the anisotropy statistic is made of — so the direction is bought
 * back for nothing. Measured after: the second-lowest crossing on the same
 * ground went from 1.0 m to 12.0 m against a 2.0 m notch at the choke.
 */
const RIDGE_FLOOR = 0.45;

/**
 * ── THE SHORE, AND IT IS THE ONE FIELD OF THE BORROWED ROW THE HEIGHT HAS TO
 *    ANSWER TO ────────────────────────────────────────────────────────────
 *
 * `battlefieldGround` spreads an authored preset and replaces `height`. Every
 * other field it borrows is a COLOUR or a texture key and cannot disagree with
 * a heightfield. **`waterLevel` is not.** It is a number in the same metres the
 * height function returns, and the level's own `water` sheet is drawn at it,
 * `Spawn.spawnClear` refuses any point under it on a sheet that burns, and
 * `Hazard` charges 52 HP a second to anything standing in it.
 *
 * That coupling was unstated, and it is the whole of why the Ember Shelf could
 * not carry a generated ground. Measured, scoria at seed 3, the deploy ring:
 *
 *     authored   ring 0% under the lava, ground 3.4-19.9 m, mean 12.8   10/10 up
 *     generated  ring 44% under the lava, ground -0.6-6.1 m, mean 1.2    0/10 up
 *
 * The generated field is written about a datum of zero — swell, swale and
 * micro are all signed and small — and scoria's lava sits at +0.55, so the
 * shelf the level is named for came out as a lava plain with the deploy ring
 * in it. `NEXT.md` and `LEVELS.geonosis`' note both recorded the cause as
 * scoria's rocks and wrecks taking the standing room with them; they are worth
 * 10 of 288 ring points against the authored ground's 3, and the lava is worth
 * 126. Mustafar's 9/10 is the same arithmetic one notch down: 8% of its ring
 * under a 56 HP/s sheet is the one man it loses.
 *
 * ── WHAT THE ANSWER IS, AND WHY IT IS A SHELF AND NOT A LIFT ────────────
 *
 * The cheap fix is to raise the whole field until nothing is under the sheet.
 * That works and it deletes the sea: `waterLevel` would still be borrowed and
 * no ground would ever reach it, so the Ember Shelf's hazard — the thing the
 * room is named for, priced around and lit by — would be off the map on the
 * one run in seven that generates its ground.
 *
 * So the battle stands on a SHELF instead, which is the shape scoria's own
 * preset note describes ("a basalt shelf standing out of a lava sea"): land
 * out to `SHELF_IN` of the deploy point, falling to `SEA_DEPTH` below the
 * sheet by `SHELF_OUT`, with the radius itself perturbed so the coast comes
 * out as bays and headlands rather than as a circle cut round the fight. The
 * flank crests ride on top of it, so a ridge that reaches past the coast is
 * left standing offshore as a stack — which is again what the authored room
 * does.
 *
 * A GROUND WITH NO SHEET (`waterLevel` −999, which is five of the seven) GETS
 * NONE OF THIS. `shore` is null and the height function is the one that was
 * measured, term for term — see the guard in `makeBattlefield`.
 */
/** How far the battle's datum stands clear of the borrowed sheet, on top of
 *  the deepest the field digs below that datum. A step, not a cliff. */
const SHELF_FREEBOARD = 1.2;
/** How deep the borrowed sea is off the shelf. Scoria's authored median depth
 *  over its own fight disc is 7.8 m (`Levels.js`'s `strewGround` note). */
const SEA_DEPTH = 7.5;
/**
 * WHERE THE WATERLINE GOES, AND IT IS DERIVED FROM THE FIGHT RATHER THAN
 * PICKED. `LEVELS[*].spawnRadius[1]` is how far out that room puts a hostile —
 * 48 m on scoria, 54 on mustafar, 46 in the Drowned Wood — and `opts.keep` is
 * how the caller states it. The coast stands one deployment ring (30 m) beyond
 * it, so every body either army places is on land by construction and the
 * shore is still inside the fight: scoria's own note prices its authored
 * coast at 30 m from the deploy point with 9.7% of the fight disc under the
 * sheet, and a generated coast at 78 m is the same room, not a lagoon at the
 * horizon. The first version put the shelf's edge at 0.60 of the map's half
 * width and measured the coast 152 m away, which is a hazard you can only see.
 */
const SHELF_MARGIN = 30;
/** …and the room's fight radius when the caller does not say. The median of
 *  the seven authored rooms. */
const SHELF_KEEP = 56;
/** How far it takes to climb from the waterline onto the shelf, and to fall
 *  from it to the sea floor. */
const SHORE_RUN_IN = 55;
const SHORE_RUN_OUT = 60;
/**
 * …AND THE LINE ITSELF IS LAND, END TO END.
 *
 * A shelf that is only a disc round the deploy point drowns the front 80 m out
 * of it, and the front is where §12.4's marks go: `burnBand` lays its swath
 * ±260 m ACROSS the line, `addFallen` a ±150 m band, and `strewWrecks` sites
 * hulls along it. All of that under lava is dressing nobody can see, on the
 * one variable §13.3 says has to be a fact you can stand on.
 *
 * So the land is the disc OR a band along the front — a causeway across the
 * sea with the fight at the middle of it, which is a shape that says what the
 * battle is about rather than one that gets the water out of the way. 62 m of
 * half-width carries the burn swath's whole depth (`rows × rowStep` ≈ 39 m)
 * and the dead band with room over.
 */
const CAUSEWAY_HALF = 62;
/** A BEACH PROFILE: steepest at the water and flattening onto the shelf.
 *  `smoothstep` is the obvious curve here and is the wrong one — its gradient
 *  is zero at BOTH ends, so the ground leaves the waterline flat and the coast
 *  comes out as a wide band of ground within a few centimetres of the sheet.
 *  On a sheet that burns, that band is a lagoon of ankle-deep lava that still
 *  kills at 52 HP a second. This one has slope 2 at the water and 0 on the
 *  shelf. */
const beach = (k) => { const t = 1 - Math.min(1, Math.max(0, k)); return 1 - t * t; };

/** In a fixed order, because a seeded pick over `Object.keys` is a pick over
 *  whatever order the file happens to be written in. */
export const REASON_ORDER = ['pass', 'ford', 'landing', 'gunline', 'wreckfield'];

/** A point on the boundary of the square map, `u` running 0..1 once round it.
 *  The map is a square and not a disc — `Terrain` is a square heightfield and
 *  `inBounds` is a square test, so "one map edge to another" is literal. */
function perimeter(u, half) {
  const e = Math.floor(((u % 1) + 1) % 1 * 4) % 4;
  const f = (((u % 1) + 1) % 1) * 4 - e;
  const a = lerp(-half, half, f);
  return e === 0 ? { x: a, z: -half }
    : e === 1 ? { x: half, z: a }
      : e === 2 ? { x: -a, z: half }
        : { x: -half, z: -a };
}

/**
 * ── 2. THE FRONT, BEFORE THE GROUND ─────────────────────────────────────
 *
 * §12.2: *"A bezier from one map edge to another, 3–5 control points, two axes
 * of advance crossing it. Six numbers."*
 *
 * The six are drawn here, once, and everything else in this file is a function
 * of them plus the reason:
 *
 *   n0  where the line meets the first edge, 0..1 round the perimeter
 *   n1  how far round the perimeter it leaves — held in [0.28, 0.72] of the
 *       way round, which cannot land on the edge it started from (a quarter
 *       each) and so cannot degenerate into a line that enters and leaves the
 *       same side
 *   n2  the first interior control's lateral swing
 *   n3  the second interior control's, so the curve can be an S and not only
 *       an arc
 *   n4  where along the line the one chokepoint sits
 *   n5  the skew between the two axes of advance
 *
 * FOUR CONTROL POINTS, which is a cubic — inside §12.2's 3–5 and the smallest
 * member of that range that can bend twice. Both interior controls are clamped
 * into the map, and a bezier lies inside the convex hull of its controls, so
 * the curve cannot leave the ground it is drawn on. That is worth having as a
 * theorem rather than as a rejection loop.
 *
 * ── WHY THE CURVE IS PULLED TOWARD THE DEPLOY POINT ─────────────────────
 *
 * A bezier between two seeded edge points passes wherever it likes, and on a
 * 620 m map "wherever it likes" is up to 300 m from where the player stands.
 * §13.3 is the rule that kills that: *"the variable is a fact a place can show
 * you from the inside"*, and the Spire's exact indictment was a variable you
 * could not see from where you were. A front the player would have to walk
 * four minutes to find is that failure with one noun changed. So the interior
 * controls are pulled until the curve passes near the origin — the deploy
 * point — and the seeded swing rides on top of that pull rather than replacing
 * it. The line is still edge to edge and still seeded in shape; what is not
 * left to the seed is whether you can see it.
 *
 * ── AND THE DEPLOY POINT IS NOT ALWAYS THE ORIGIN ───────────────────────
 *
 * Every paragraph above says "the deploy point" and the first version wrote
 * `(0, 0)` for it, which is true of five of the seven theatres and false of
 * the two that matter. `LEVELS.scoria.start` is `(-22, 68)` — the Ember
 * Shelf moved its opening 71 m off the origin so the lava sea would be inside
 * the fight — so the curve was being pulled through a point the player does
 * not stand on, the chokepoint was anchored to it, and the shelf below is
 * measured from it. `opts.deploy` is how a caller says where its player
 * actually lands; the default is the origin, which is what every check and
 * five of the seven levels mean anyway.
 *
 * @param {number} seed   the deployment seed
 * @param {object} opts   `scale` (map side, metres), optional `reason`,
 *                        optional `deploy` ({x,z}, where the player lands) and
 *                        optional `sea` (the borrowed ground's `waterLevel`)
 */
export function planBattle(seed, opts = {}) {
  const scale = opts.scale ?? 620;
  const half = scale / 2;
  const deploy = { x: opts.deploy?.x ?? opts.deploy?.[0] ?? 0,
    z: opts.deploy?.z ?? opts.deploy?.[1] ?? 0 };
  /* ONE STREAM, OWNED, AND NOT A MODULE-SCOPE ONE. HANDOFF §2.11: a shared
   * generator makes a plan depend on what else drew this process. A plan is a
   * pure function of its seed or it is not a seed. */
  const rng = makeRng((seed | 0) ^ 0x5eeded17);
  const n = [rng(), rng(), rng(), rng(), rng(), rng()];

  const reason = opts.reason ?? REASON_ORDER[Math.floor(rng() * REASON_ORDER.length) % REASON_ORDER.length];
  const R = REASONS[reason];
  if (!R) {
    throw new Error(`Battlefield: there is no '${reason}' reason to fight. `
      + `The table holds ${REASON_ORDER.join(', ')}`);
  }

  const P0 = perimeter(n[0], half);
  const P3 = perimeter(n[0] + 0.28 + n[1] * 0.44, half);
  const cx = P3.x - P0.x, cz = P3.z - P0.z;
  const clen = Math.hypot(cx, cz) || 1;
  /* The chord's own perpendicular. Lateral offsets are measured on it so the
   * two interior controls swing across the line rather than along it, which is
   * what bends the curve instead of sliding its parameterisation. */
  const px = -cz / clen, pz = cx / clen;
  /* HOW FAR THE CHORD MISSES THE DEPLOY POINT BY, laterally. Cancelling it is
   * the pull described above; the seeded swing is added to it. A cubic whose
   * two interior controls both sit at lateral `q` passes through lateral
   * 0.75·q at the midpoint, so the pull is over-corrected by 4/3 to land the
   * midpoint ON the origin rather than three quarters of the way to it. */
  const miss = ((deploy.x - P0.x) * px + (deploy.z - P0.z) * pz) * (4 / 3);
  const swing = clen * 0.16;
  const lat1 = miss + (n[2] - 0.5) * 2 * swing;
  const lat2 = miss + (n[3] - 0.5) * 2 * swing;
  const inside = (p) => ({ x: clamp(p.x, -half + 6, half - 6), z: clamp(p.z, -half + 6, half - 6) });
  const P1 = inside({ x: P0.x + cx / 3 + px * lat1, z: P0.z + cz / 3 + pz * lat1 });
  const P2 = inside({ x: P0.x + cx * 2 / 3 + px * lat2, z: P0.z + cz * 2 / 3 + pz * lat2 });

  const curve = polyline([P0, P1, P2, P3], 129);

  /* ── THE ONE CHOKEPOINT'S POSITION, and it is anchored to the deploy point
   * for the same reason the curve is. §12.3 allows exactly one — "two reads as
   * a maze" — so its position is a single number, and a number that put it 280
   * m up the line would be a chokepoint the player never crosses. The seed
   * moves it ±14% of the line's length either side of the nearest point on the
   * line to where the player stands. */
  const nearOrigin = nearestOn(curve, deploy.x, deploy.z);
  const chokeS = clamp(nearOrigin.s + (n[4] - 0.5) * 0.28 * curve.length,
    curve.length * 0.12, curve.length * 0.88);
  const choke = atArc(curve, chokeS);

  /* THE NORMAL THAT POINTS AWAY FROM THE DEPLOY POINT is the axis of advance:
   * the enemy is on the far side of the line, so the direction the fighting
   * moves in is the one that leaves the player behind it. Getting this
   * backwards points the whole battle at the empty half of the map, which is
   * exactly the failure `Front.frontCamera`'s note records for the yaw. */
  let nx = -choke.tz, nz = choke.tx;
  if (nx * (choke.x - deploy.x) + nz * (choke.z - deploy.z) < 0) { nx = -nx; nz = -nz; }
  const bearing = Math.atan2(nz, nx);
  /* TWO AXES OF ADVANCE CROSSING IT (§12.2), and they are not one axis drawn
   * twice: each army comes in off the normal by `skew`, so the two thrusts
   * converge on the choke from bearings that differ by π − 2·skew. As LINES
   * mod π their bisector is the normal itself, which is why the ridge field
   * below can be anisotropic "along the advance bearing" without having to
   * pick a favourite army. */
  const skew = lerp(0.16, 0.52, n[5]);

  /* WHICH OF THE CURVE'S TWO SIDES IS THE ADVANCE SIDE, DECIDED ONCE AND
   * CARRIED ON THE PLAN. `segDist` reports left-or-right of the segment it
   * hit, and which of those is "toward the enemy" depends on which end of the
   * perimeter the seed started drawing from — so on half the seeds it comes
   * back inverted. It used to be re-derived inside `makeBattlefield`, which
   * was fine while the height function was the only reader; `frontLine` below
   * is a second reader and a second probe would be HANDOFF §2.4 exactly. One
   * probe 30 m up the advance from the choke settles it for every reader.
   * (The first version fixed the sign per sample against the choke's tangent
   * plane instead, which is a different surface from the curve: on a bezier
   * with any bend in it the two disagree in a wedge behind the bend, and the
   * ground there took the far side's standoff while sitting on the near
   * side.) */
  const orient = nearestOn(curve, choke.x + nx * 30, choke.z + nz * 30).d >= 0 ? 1 : -1;

  return {
    seed: seed | 0, scale, reason, shape: R, numbers: n,
    control: [P0, P1, P2, P3], curve, orient, deploy,
    /** How far out this room puts a body — `LEVELS[*].spawnRadius[1]`. The
     *  shore below stands clear of it; see `SHELF_MARGIN`. */
    keep: Number.isFinite(opts.keep) ? opts.keep : SHELF_KEEP,
    /** The borrowed ground's water line, or null where there is no sheet.
     *  `makeBattlefield`'s shore reads it; see the note there. */
    sea: Number.isFinite(opts.sea) && opts.sea > -900 ? opts.sea : null,
    choke: { x: choke.x, z: choke.z, s: chokeS, t: chokeS / curve.length,
      tx: choke.tx, tz: choke.tz },
    /** The axis of advance: unit, pointing from the deploy point across the line. */
    dir: { x: nx, z: nz },
    bearing,
    /** §12.2's two axes, in radians. */
    advance: [bearing + skew, bearing + Math.PI - skew],
    skew,
    /** How far the tangent at the choke stands from the deploy point. */
    distance: (choke.x - deploy.x) * nx + (choke.z - deploy.z) * nz,
  };
}

/** Flatten a cubic bezier into an arc-length-parameterised polyline. */
function polyline(P, n) {
  const xs = new Float64Array(n), zs = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    xs[i] = b0 * P[0].x + b1 * P[1].x + b2 * P[2].x + b3 * P[3].x;
    zs[i] = b0 * P[0].z + b1 * P[1].z + b2 * P[2].z + b3 * P[3].z;
    if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  return { xs, zs, cum, n, length: cum[n - 1] };
}

/**
 * THE POINT AT ARC LENGTH `s` ON THE LINE, with the unit tangent there.
 *
 * Exported because a check that wants to walk the front has to walk THE front:
 * a second flattening of the same bezier written in a tool is HANDOFF §2.4's
 * defect waiting to happen — it would agree for a while and then measure a
 * line the ground was not built from.
 */
export function alongFront(plan, s) { return atArc(plan.curve, s); }

/** The point at arc length `s`, with the unit tangent there. */
function atArc(C, s) {
  const want = clamp(s, 0, C.length);
  let i = 1;
  while (i < C.n - 1 && C.cum[i] < want) i++;
  const seg = C.cum[i] - C.cum[i - 1] || 1;
  const f = (want - C.cum[i - 1]) / seg;
  const tx = (C.xs[i] - C.xs[i - 1]) / seg, tz = (C.zs[i] - C.zs[i - 1]) / seg;
  return { x: lerp(C.xs[i - 1], C.xs[i], f), z: lerp(C.zs[i - 1], C.zs[i], f), tx, tz };
}

/**
 * THE NEAREST POINT ON THE LINE, AND WHICH SIDE OF IT YOU ARE ON.
 *
 * Called once per heightfield sample — 115 600 times on a full-resolution
 * geonosis — so the search matters. A flat scan of all 128 segments cost 14 ms
 * a build here and a coarse-then-refine costs 4, and the coarse pass is safe
 * because the curve is a single cubic: its tangent turns monotonically, so a
 * 16-point scan cannot be more than one coarse step away from the true
 * minimum. The refine window is two coarse steps either way, which is that
 * bound with a factor of two on it.
 *
 * @returns {{d:number, s:number}} signed perpendicular distance (positive on
 *          the advance side once the caller has fixed the sign convention),
 *          and the arc length of the nearest point.
 */
function nearestOn(C, x, z) {
  const stride = Math.max(1, (C.n - 1) >> 4);
  let bi = 1, bd = Infinity;
  for (let i = stride; i < C.n; i += stride) {
    const d = segDist(C, i, x, z);
    if (d.q < bd) { bd = d.q; bi = i; }
  }
  const lo = Math.max(1, bi - 2 * stride), hi = Math.min(C.n - 1, bi + 2 * stride);
  let best = null;
  for (let i = lo; i <= hi; i++) {
    const d = segDist(C, i, x, z);
    if (!best || d.q < best.q) best = d;
  }
  return { d: best.side * Math.sqrt(best.q), s: best.s };
}

/** Squared distance from (x,z) to segment i−1→i, plus its arc length and the
 *  side of the segment the point falls on. */
function segDist(C, i, x, z) {
  const ax = C.xs[i - 1], az = C.zs[i - 1];
  const bx = C.xs[i] - ax, bz = C.zs[i] - az;
  const len2 = bx * bx + bz * bz || 1e-9;
  const t = clamp(((x - ax) * bx + (z - az) * bz) / len2, 0, 1);
  const dx = x - (ax + bx * t), dz = z - (az + bz * t);
  return { q: dx * dx + dz * dz, s: C.cum[i - 1] + t * Math.sqrt(len2),
    side: (bx * dz - bz * dx) >= 0 ? 1 : -1 };
}

/**
 * ── 3. THE HEIGHT FUNCTION, DERIVED FROM THE FRONT ──────────────────────
 *
 * Three claims in §12.3, and each one is a construction here rather than a
 * tuning: the check measures them on a BUILT heightfield, which is the only
 * place they can be false.
 *
 *   HIGH GROUND FLANKS THE FRONT AND NEVER SITS ON IT. The ridge amplitude is
 *     `smoothstep(standoff, standoff + rise, |d|)`, which is exactly zero for
 *     every point within `standoff` metres of the line. Not "small": zero. The
 *     corridor is then the only ground the two armies can meet on, which is
 *     what makes the line a line.
 *
 *   EXACTLY ONE CHOKEPOINT. The flank belts are broken in exactly one place —
 *     a gaussian notch in the amplitude at one arc position — and a gaussian
 *     has one maximum, so "exactly one" is a property of the function and not
 *     of a lucky seed. §12.3's reason for one is that "two reads as a maze";
 *     the reason for making it a notch in the SHOULDER rather than a dip in
 *     the line is that the line is already low everywhere, so the only thing
 *     that can pinch a crossing is what stands beside it.
 *
 *   THE RIDGE FIELD IS ANISOTROPIC ALONG THE ADVANCE BEARING. The noise is
 *     sampled in the advance frame with different wavelengths on the two axes
 *     — 215 m along, 56 m across for a pass — so the crests run TOWARD the
 *     line as fingers with draws between them, instead of being the isotropic
 *     lumps every other preset in this game uses. That is the clause that
 *     turns noise into ground that moves in a direction, and it is the one
 *     that no amount of looking at a screenshot settles: it is a directional
 *     variogram, and the check computes one.
 *
 * The envelope and the noise are exposed separately (`amplitude`, `ridge`) so
 * a check can ask WHERE the ridge field is without owning a second copy of the
 * mask — HANDOFF §2.4. What it must not do is ask this file for the heights;
 * those come off the built `Terrain`.
 */
export function makeBattlefield(plan) {
  const R = plan.shape;
  const C = plan.curve;
  const ca = Math.cos(plan.bearing), sa = Math.sin(plan.bearing);
  /* Per-plan noise offsets: the engine's Perlin has ONE permutation table for
   * the process, so two seeds that sample it at the same coordinates get the
   * same hills. The offset is how a seeded field is drawn from an unseeded
   * noise, and it has to be large enough that two seeds do not overlap — the
   * table repeats every 256 units, so the offsets are spread over that. */
  const rng = makeRng((plan.seed | 0) ^ 0x2b1a77c3);
  const ox = rng() * 256, oz = rng() * 256, oy = rng() * 256;

  /* WHICH OF THE CURVE'S TWO SIDES IS THE ADVANCE SIDE — off the plan, which
   * decided it once for every reader (see the note at `planBattle`). */
  const orient = plan.orient;

  /** Signed distance to the line — positive on the advance side, always — with
   *  the arc length of the nearest point on it. */
  const at = (x, z) => {
    const q = nearestOn(C, x, z);
    return { d: q.d * orient, s: q.s };
  };

  /**
   * THE NOTCH THAT IS THE ONE CHOKEPOINT: 1 across the whole flank, 0 in one
   * band, over `gap` metres. A gaussian has exactly one maximum and therefore
   * this has exactly one zero — §12.3's "exactly one chokepoint (two reads as
   * a maze)" as arithmetic rather than as a hope.
   *
   * MEASURED IN THE CHOKE'S OWN FRAME, NOT IN ARC LENGTH ALONG THE LINE, and
   * the difference is not cosmetic. The first version notched at
   * `|s − choke.s| < gap`, which is a notch in the near wall rather than a way
   * through: a point 200 m out from the choke on the inside of a bend has its
   * nearest point somewhere else on the curve entirely, so the notch closed
   * over behind itself. Measured on a gun line — whose far shoulder stands
   * 118 m back and so is read at 200 m out — the lowest crossing on the whole
   * map came out **262 m from the chokepoint the plan had named**, i.e. the
   * ground had a pass in it and it was not the one the battle was about.
   * Projecting onto the tangent AT the choke makes the corridor straight and
   * makes it run all the way out, which is what a pass is.
   */
  const gapAt = (x, z) => {
    const k = ((x - plan.choke.x) * plan.choke.tx + (z - plan.choke.z) * plan.choke.tz) / R.gap;
    return 1 - Math.exp(-k * k);
  };

  /** The ridge field alone, in [0,1], anisotropic in the advance frame. */
  const ridge = (x, z) => {
    const u = (x * ca + z * sa) / R.grain[0] + ox;
    const v = (-x * sa + z * ca) / R.grain[1] + oz;
    return ridged2(u, v, 3);
  };

  /** The envelope, from an already-taken distance query. Metres of crest.
   *  `height` and `amplitude` are the same expression called twice rather than
   *  written twice — a mask a check can read and a mask the ground is built
   *  from that could drift apart are HANDOFF §2.3's defect exactly. */
  const envelope = (x, z, q) => {
    const side = q.d >= 0 ? 0 : 1;
    const stand = R.standoff[side];
    return smoothstep(stand, stand + R.rise, Math.abs(q.d)) * gapAt(x, z) * R.crest[side];
  };

  /** The envelope at a point: 0 within the standoff, 0 in the choke's corridor,
   *  `crest` metres out on the flanks. */
  const amplitude = (x, z) => envelope(x, z, at(x, z));

  /**
   * THE SHELF THE BATTLE STANDS ON, or null where the borrowed ground has no
   * sheet to stand out of. See the long note over `SHELF_FREEBOARD`.
   *
   * `draft` is how far below its own datum the rest of the height function can
   * dig — `swell` is an fbm in [−1, 1] scaled by `R.swell`, the swale cuts
   * `R.swale` and the micro term 9 cm — so a datum of `sea + draft +
   * freeboard` is dry ON THE SHELF BY CONSTRUCTION rather than by measurement.
   * The crest is added on top and is signed positive, so it cannot drown what
   * the datum lifted.
   */
  const shore = plan.sea === null ? null : (() => {
    const draft = R.swale + R.swell + 0.1;
    const rise = draft + SHELF_FREEBOARD;
    const sea = plan.sea;
    const rWater = Math.min(plan.keep + SHELF_MARGIN, plan.scale * 0.42);
    const d = plan.deploy;
    /** Metres above the sheet, given metres of dry ground still to spare.
     *  Positive inland, negative out to sea. */
    const above = (k) => (k >= 0 ? rise * beach(k / SHORE_RUN_IN)
      : -SEA_DEPTH * beach(-k / SHORE_RUN_OUT));
    return (x, z, q) => {
      /* THE COAST IS NOT A CIRCLE. ±18% on the radius at a 190 m wavelength is
       * what turns the shelf's edge into bays and headlands; a clean circle
       * reads as an arena boundary, which is the one thing a coastline must
       * not read as. The perturbation is on the RADIUS and not on the height,
       * so it moves where the water reaches without moving the datum the
       * battle stands on. */
      const wob = 1 + 0.18 * fbm2(x * 0.0053 + ox, z * 0.0053 - oz, 2);
      const r = Math.hypot(x - d.x, z - d.z) * wob;
      const w = Math.abs(q.d) * (1 + 0.22 * fbm2(x * 0.0061 - oz, z * 0.0061 + oy, 2));
      /* The higher of the two shores wins, which is what "the land is the disc
       * OR the causeway" means as arithmetic. */
      return sea + Math.max(above(rWater - r), above(CAUSEWAY_HALF - w));
    };
  })();

  const height = (x, z) => {
    const q = at(x, z);
    const ad = Math.abs(q.d);
    const stand = R.standoff[q.d >= 0 ? 0 : 1];
    /* THE CORRIDOR, CUT. Only inside the standoff, and it is what separates a
     * ford from a pass: the ford's line is the lowest ground on the map, the
     * pass's is merely the flattest. Squared cosine rather than a smoothstep
     * so the floor of the cut is flat and its edges meet the plain with zero
     * gradient — a swale with a lip round it is a moat. */
    const c = Math.cos(clamp(ad / stand, 0, 1) * Math.PI * 0.5);
    const swale = -R.swale * c * c;
    /* THE GROUND THAT IS NOT ABOUT THE BATTLE. Two octaves at 210 m, under the
     * eye's threshold as relief and over the physics grid as slope — the same
     * trade `TERRAIN_PRESETS.geonosis` makes with its swell, and for the same
     * reason: a map whose ONLY shape is the front reads as a diagram. */
    const swell = fbm2(x * 0.0048 + oy, z * 0.0048 - oy, 2) * R.swell;
    /* And a micro term, because the loose layer and the footfall sampler both
     * read gradients at well under a metre. 9 cm, geonosis' own figure. */
    const micro = fbm2(x * 0.14 + ox, z * 0.14 + oz, 3) * 0.09;
    /* THE SHELF, and it is a DATUM the four terms above ride on rather than a
     * sixth term added beside them: on a ground with no sheet it is exactly
     * zero and the expression is the one §12.3 was measured on. */
    const base = shore ? shore(x, z, q) : 0;
    return base + swell + swale + micro + envelope(x, z, q) * (RIDGE_FLOOR + (1 - RIDGE_FLOOR) * Math.pow(ridge(x, z), 1.15));
  };

  return { plan, height, ridge, amplitude, at, gapAt, shore };
}


/**
 * ── THE ONE READER: WHICH SIDE OF THE FRONT IS THIS, AND HOW FAR FROM IT ──
 *
 * `Front.js`'s dressing asks one question of a front and it asks it four
 * times: `burnt` asks which side a smoke column is on, `burnBand` asks for a
 * point a given depth behind the line at a given position along it,
 * `walkingBarrage` walks a battery's fire along it and `addFallen` lays a band
 * across it. All four were written against a HALF-PLANE — a bearing and a
 * distance — because that is all a front was when they were written.
 *
 * `frontAtChoke` below bridged the bezier to that by taking the curve's
 * tangent at the chokepoint, and the cost of the linearisation was measured
 * rather than assumed: the tangent has a REACH, 80 m on a tight seed and 296
 * on a lazy one, and asked for `burnBand`'s default 260 m it laid three
 * quarters of the swath on the clean side. The note there argued that teaching
 * the four dressing functions about the curve would be four copies of the
 * curve, and that is true — of four copies. It is not true of one.
 *
 * THIS IS THE ONE. Every caller asks the same two questions of it and neither
 * of them mentions a shape:
 *
 *     side(x, z)      → { d, u }   signed metres from the line — POSITIVE on
 *                                  the burnt side, always — and metres along
 *                                  it from the point the dressing centres on.
 *     place(u, depth) → { x, z, tx, tz, nx, nz }   the point `depth` metres
 *                                  into the burnt side at `u` along the line,
 *                                  with the local frame there.
 *
 * The two are inverses of each other to within the flattening, which is what
 * makes them one object and not two: `side(place(u, d))` is `{ d, u }`.
 *
 * A HALF-PLANE IS THE DEGENERATE CASE AND IS BUILT AS ONE. Given a front with
 * no curve, `at(u)` is `origin + dir·distance + across·u` and `side` is the
 * dot product `burnt` has always taken — the same arithmetic, in the same
 * order, so an authored level that dresses a straight front gets the identical
 * ground it got before. `crater-log.mjs` asserts that rather than assuming it.
 *
 * IT DOES NOT FLATTEN ANYTHING. `plan.curve` was flattened once, by
 * `planBattle`, and `atArc` and `nearestOn` above are the readers of it. A
 * second flattening written in `Front.js` is HANDOFF §2.4's defect exactly: it
 * would agree for a while and then dress a line the ground was not built from.
 *
 * @param {object} front  either `{ bearing, distance, dir }` (a half-plane, as
 *        `Front.frontAt` returns) or one carrying `plan` (as `frontAtChoke`
 *        returns), or a plan itself.
 */
const LINES = new WeakMap();

export function frontLine(front) {
  if (!front) throw new Error('Battlefield: there is no front to read');
  const had = LINES.get(front);
  if (had) return had;
  const plan = front.curve ? front : front.plan;
  /* HOW FAR THE LINE HAS COME SINCE THE PLAN WAS DRAWN. The bezier is where
   * the battle is; the ENGAGEMENT is where the line has got to, and §14's
   * schedule closes it 40 m at a time. Offsetting the curve along its own
   * normal is the same advance a half-plane expresses by changing `distance`,
   * and it keeps the shape of the front — a front that advanced by being
   * redrawn would be a different battle each engagement, which is exactly the
   * failure §13 records against the Spire. */
  const line = plan && plan.curve ? curvedLine(plan, front.offset ?? 0) : flatLine(front);
  LINES.set(front, line);
  return line;
}

/** THE CURVE, read through the arc-length table `planBattle` already built.
 *  `u` is metres along the line FROM THE CHOKEPOINT — signed, so the dressing
 *  centres on the one place §12.3 allows and runs both ways from it, which is
 *  the same convention the half-plane has (u = 0 at the foot of the bearing). */
function curvedLine(plan, offset) {
  const C = plan.curve, mid = plan.choke.s, o = plan.orient;
  const at = (u) => {
    const p = atArc(C, mid + u);
    /* The burnt-side normal: the tangent turned a quarter, with the sign the
     * plan settled once for every reader. */
    return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx: -p.tz * o, nz: p.tx * o };
  };
  return {
    curved: true,
    /** How far the line runs each way from the centre before it leaves the map. */
    back: mid, ahead: C.length - mid, length: C.length,
    at,
    place: (u, depth) => {
      const f = at(clamp(u, -mid, C.length - mid));
      const k = depth + offset;
      return { x: f.x + f.nx * k, z: f.z + f.nz * k,
        tx: f.tx, tz: f.tz, nx: f.nx, nz: f.nz };
    },
    side: (x, z) => { const q = nearestOn(C, x, z); return { d: q.d * o - offset, u: q.s - mid }; },
  };
}

/** THE HALF-PLANE, i.e. the same object with the curvature set to zero. */
function flatLine(front) {
  const dx = front.dir.x, dz = front.dir.z;
  /* ACROSS the advance: the line is the set of points at `distance` along the
   * bearing, so it runs along the perpendicular. `Front.burnBand` has always
   * built this pair as `(-dz, dx)` and the sign matters — it is what makes
   * `u` increase in the same rotational direction as the curve's arc length. */
  const ax = -dz, az = dx;
  const ox = front.origin?.x ?? 0, oz = front.origin?.z ?? 0;
  const bx = ox + dx * front.distance, bz = oz + dz * front.distance;
  const at = (u) => ({ x: bx + ax * u, z: bz + az * u, tx: ax, tz: az, nx: dx, nz: dz });
  return {
    curved: false,
    back: Infinity, ahead: Infinity, length: Infinity,
    at,
    place: (u, depth) => ({ x: bx + ax * u + dx * depth, z: bz + az * u + dz * depth,
      tx: ax, tz: az, nx: dx, nz: dz }),
    side: (x, z) => ({ d: (x - ox) * dx + (z - oz) * dz - front.distance,
      u: (x - ox) * ax + (z - oz) * az }),
  };
}

/**
 * ── 5. THE PALETTE IS NOT GENERATED ─────────────────────────────────────
 *
 * §12.5, verbatim and in full: *"Do not generate the palette. Pick from
 * authored sets."*
 *
 * The strongest available form of "pick from authored sets" is to not have a
 * palette at all: this spreads an authored preset row and replaces exactly one
 * key. `sandColor`, `rockColor`, `gritColor`, `dustColor`, `crustColor`,
 * `lagColor`, `sheetColor`, `packedColor`, `slopeBands`, `rockUpland`, `maps`,
 * `crust`, `strataH`, `ripple`, `macro`, `wind`, `loose`, `detail`, `waterLevel`
 * and `rockAt` are the base ground's own — not copied, not sampled, not
 * perturbed, and NOT ENUMERATED HERE either, which is the point of a spread:
 * a field added to a preset tomorrow is carried by this line, and a generated
 * ground can never be missing one. (`_shared.mjs`'s snapshot rule, in the
 * other direction: name no field and you cannot miss one.)
 *
 * The art direction is the reason and it is not aesthetics. §11 is flat cel
 * bands with three tones and ≥0.18 luma between them; a generated hue lands
 * between two authored bands and the whole level goes soft. A generated ground
 * next to seven authored ones would be the one that looks wrong, and it would
 * look wrong in the frame the mode is judged on.
 *
 * ROOFED AND FLAT GROUNDS ARE REFUSED rather than silently accepted. A hangar
 * deck has `flat: true` and a ceiling in the level around it; deriving a
 * 37 m ridge line inside it produces a heightfield that intersects its own
 * roof, and the failure would show up as a lighting bug three files away.
 *
 * @param {string} baseKey  a name in `TERRAIN_PRESETS`
 * @param {number} seed     the deployment seed
 * @param {object} opts     forwarded to `planBattle` (`reason` to force a row)
 */
export function battlefieldGround(baseKey, seed, opts = {}) {
  const base = TERRAIN_PRESETS[baseKey];
  if (!base) {
    throw new Error(`Battlefield: there is no '${baseKey}' ground to borrow. `
      + `The table holds ${Object.keys(TERRAIN_PRESETS).join(', ')}`);
  }
  if (base.flat || base.roofed) {
    throw new Error(`Battlefield: '${baseKey}' is a floor, not a field — `
      + 'a front cannot be derived on ground that has a roof over it');
  }
  /* THE BORROWED SHEET GOES IN WITH THE SCALE, because it is the one field of
   * the row a height function can contradict — see `SHELF_FREEBOARD`. A caller
   * that overrides it in `opts` is asking for a different sea, which is its
   * business; nothing in the game does. */
  const plan = planBattle(seed, { scale: base.scale, sea: base.waterLevel, ...opts });
  /* THE SHELF STANDS OUT OF THE SHEET ONLY IF IT IS ABOVE IT EVERYWHERE THE
   * FIGHT REACHES, and that is arithmetic rather than a hope: `rise` is the
   * deepest the field digs below its datum plus a step. Asserted here rather
   * than in a check because the caller is what decides `keep`. */
  const field = makeBattlefield(plan);
  /** The name says what it borrowed. A generated ground that named itself
   *  `geonosis` would shadow the authored one in every diagnostic that prints
   *  a preset key, which is §13.5's failure in miniature. */
  const key = `front:${baseKey}`;
  const preset = { ...base, height: (x, z) => field.height(x, z), battlefield: plan };
  return { key, preset, plan, field, base: baseKey };
}

/**
 * THE ONLY DOOR INTO `TERRAIN_PRESETS`, AND IT DOES NOT OVERWRITE.
 *
 * `Terrain` resolves its shape by NAME out of that table and throws on a name
 * it does not hold, deliberately (see its constructor). So a generated ground
 * has to be in the table to be built at all, and a table that can be written
 * is a table an authored ground can be deleted from — which is precisely the
 * thing §13.5 forbids. Hence: install refuses a name that already exists, and
 * `removeGround` refuses to delete a row that is not a generated one.
 *
 * A caller that installs must remove, in a `finally`. HANDOFF §2.9: this is a
 * module-scope singleton, and a suite that leaves a row in it hands every
 * later suite in the process a ground nobody authored.
 */
export function installGround(key, preset) {
  if (Object.prototype.hasOwnProperty.call(TERRAIN_PRESETS, key)) {
    throw new Error(`Battlefield: '${key}' is already a ground — a generated one must not shadow it`);
  }
  TERRAIN_PRESETS[key] = preset;
  return key;
}

/** Take a generated ground back out. Refuses anything it did not put there. */
export function removeGround(key) {
  const p = TERRAIN_PRESETS[key];
  if (!p) return false;
  if (!p.battlefield) {
    throw new Error(`Battlefield: '${key}' is an authored ground and this file did not install it`);
  }
  delete TERRAIN_PRESETS[key];
  return true;
}

/**
 * THE BRIDGE TO THE DRESSING, so §12.4's marks land on §12.2's line.
 *
 * `Front.js` takes a front as `{ bearing, distance, dir }` — a half-plane — and
 * its own header argues that this is the bezier's degenerate case and the right
 * object for a kill test. The two do not have to disagree: the tangent to the
 * curve AT THE CHOKE is a half-plane, and it is the one the player is looking
 * at, so handing that to `burnBand`, `walkingBarrage` and `addFallen` puts the
 * burn, the barrage and the dead across the generated line exactly where the
 * generated ground says the fighting was.
 *
 * It is a LINEARISATION and it is worth naming as one: 200 m up the curve the
 * tangent and the line have parted company by whatever the bezier's curvature
 * says, and the marks there will sit off the line. §12.4's own numbers keep
 * that inside the frame — the fallen band is ±150 m and the burn is ±260 m —
 * and the alternative, teaching four dressing functions about a curve, is four
 * copies of the curve. One conversion, named, beats four.
 */
export function frontAtChoke(plan, engagement = 1, tol = 20) {
  /* HOW FAR THE STAND-IN IS GOOD FOR, computed rather than assumed, because
   * the answer moves with the seed: a nearly straight line is good to the map
   * edge and a hard S is good for 90 m. Walk out along the tangent both ways
   * until the curve has drifted `tol` from it, and hand the caller the smaller
   * of the two as `reach`. `burnBand`'s `half` defaults to 260 m, and MEASURED
   * on a pass at seed 3 that put the far end of the swath 157 m on the CLEAN
   * side of the curve — three quarters of the burn on ground the line has not
   * crossed. With `half: reach` it is on the burnt side by construction.
   *
   * 20 m of tolerance is the burn band's own depth (`rows × rowStep` ≈ 39 m,
   * so half of it): inside that the swath still straddles the line, which is
   * what the swath is for. */
  const step = 8, cap = plan.scale * 0.5;
  let reach = cap;
  for (const sign of [1, -1]) {
    let k = 0;
    while (k < cap) {
      const x = plan.choke.x + plan.choke.tx * sign * (k + step);
      const z = plan.choke.z + plan.choke.tz * sign * (k + step);
      if (Math.abs(nearestOn(plan.curve, x, z).d) > tol) break;
      k += step;
    }
    reach = Math.min(reach, k);
  }
  return { bearing: plan.bearing, distance: plan.distance, engagement, reach,
    dir: { x: plan.dir.x, z: plan.dir.z },
    /* WHERE THE HALF-PLANE IS MEASURED FROM. `planBattle` takes a deploy point
     * and `distance` is measured from it, so a front handed to a dressing
     * function that works in world coordinates has to say so. `Front.frontAt`
     * leaves this undefined and `flatLine` reads that as the origin, which is
     * the convention it has always had. */
    origin: { x: plan.deploy.x, z: plan.deploy.z },
    /** THE CURVE ITSELF, so `frontLine` can read the front the ground was
     *  built from rather than the tangent that stands in for it. The four
     *  fields above remain exact and remain what `frontCamera` and the smoke
     *  schedule read; what they are no longer is the only thing on offer. */
    plan };
}
