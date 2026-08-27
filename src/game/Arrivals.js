/**
 * BATTLEFRONT BORZ — arrivals.
 *
 * WHAT WAS WRONG: `WaveDirector.update` did this, and only this —
 *
 *     const pos = ctx.pickSpawn(type);
 *     const e = ctx.spawnEnemy(type, pos);
 *
 * — so every body in the game came into existence fully formed, standing on
 * the sand, 34 to 56 metres away, facing you. No vehicle, no door, no dust, no
 * warning; a wave was a list of `new Enemy(...)` calls with a timer between
 * them. On the dunes you could watch it happen: a droid was not there, and
 * then it was, and the only thing that had changed was a number in a queue.
 *
 * An arrival is the answer, and it is a THING IN THE WORLD rather than an
 * animation played on a body:
 *
 *   dropship   a gunship comes down out of the sky, flares, hovers a few
 *              metres up, drops its squad and climbs away
 *   gate       a sally port rumbles, parts, and they walk out of the dark
 *   march      they come over the far edge of the map on foot, from beyond
 *              the ring anything is normally spawned at, and walk the
 *              distance in
 *
 * ── THE INVARIANT ─────────────────────────────────────────────────────────
 *
 * Everything here exists to make one property true, and it is the property
 * tools/checks/arrivals.mjs measures:
 *
 *     NOTHING IS DELIVERED NEAR THE PLAYER UNLESS SOMETHING THE PLAYER COULD
 *     SEE HAS BEEN STANDING WHERE IT ARRIVES FOR AT LEAST `ARRIVAL_LEAD`
 *     SECONDS FIRST.
 *
 * A dropship and a gate satisfy it by being visible for seconds before they
 * deliver anything. A march satisfies it by delivering at `MARCH_RADIUS` times
 * the level's own spawn ring — far enough out that the body walks in as a
 * silhouette on the horizon, which is itself the announcement. Every delivery
 * records which of the two it passed on, so a future arrival that quietly
 * satisfies neither cannot be added without the check saying so.
 *
 * ── AND THE SECOND HALF OF IT, which cost geonosis its whole opening minute.
 * "A silhouette on the horizon" is a claim about what the RENDERER does with a
 * body at that range, and this file had no idea where the renderer stops. Past
 * `Cohorts.L3_AT` there is no silhouette: no outline, no own mesh, one shared
 * pose. So the sentence above has a ceiling now, and it is `marchBand`:
 *
 *     NOTHING IS EVER PLACED BEYOND THE DISTANCE AT WHICH IT STOPS DRAWING
 *     ITSELF.
 *
 * Derived from the renderer's own constant, not from any level's numbers, so
 * the next map with a wide ring cannot reintroduce the defect.
 *
 * ── COSTS ─────────────────────────────────────────────────────────────────
 *
 * Every geometry and every material below is built ONCE, at module scope, and
 * shared by every arrival that ever runs — the single exception is a dropship's
 * landing wash, whose opacity is animated per ship and which is disposed with
 * it. An arrival is therefore a handful of Mesh objects and a group transform.
 *
 * That is what makes it safe that `World.unload` does not know this file
 * exists: the director parks its one persistent group in `world.statics`, the
 * list World already empties out of the scene when a level goes away, and a
 * ship caught mid-landing by a level change leaves nothing behind but shared
 * geometry that was going to be reused anyway.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
import { spawnClear, bladeClear } from './Spawn.js';
/* The one number in this file that is not this file's to choose. See
 * `marchBand` — a placement rule that does not know where the renderer
 * stops drawing a body is a placement rule that will put one past it. */
import { L3_AT } from './Cohorts.js';
import { armyForOrder, opposingArmy } from './Databank.js';

/**
 * THE SHIP'S MODEL, INJECTED — and the direction of the arrow is the whole
 * reason this is a setter and not an import.
 *
 * `src/game/Vehicles.js` builds the LAAT/i, and it registers its archetypes
 * with `Object.assign(ARCHETYPES, …)` at module scope. This file is reached
 * from `Enemy.js → Dojo.js → Waves.js → Arrivals.js`, so a static edge from
 * here to Vehicles.js closes that cycle and Vehicles' registration runs while
 * `ARCHETYPES` is still in its temporal dead zone — a `ReferenceError` on boot,
 * not a warning. That is the identical trap `Waves.js`'s note above
 * `sandboxUnits` records, sprung from the other end, and it was sprung: the
 * import went in, the whole suite failed to load, and this is what replaced it.
 *
 * So the dependency points the other way. Whoever owns both — `Levels.js`,
 * which is the module that decides what levels and what bodies exist — hands
 * the builder in, exactly as it hands in `ARRIVAL_BY_TERRAIN` entries. With
 * nothing registered the primitives below are used and every range, lead time
 * and flare this director is tuned at is unchanged, so a tree without
 * Vehicles.js in it still flies.
 */
let _shipModel = null;
export function setDropshipModel(fn) { _shipModel = typeof fn === 'function' ? fn : null; }

/**
 * …AND THE OTHER SHIP, WHICH IS A DIFFERENT SHIP ON PURPOSE.
 *
 * The gunship above delivers ENEMIES: it comes down, hovers, drops a squad and
 * climbs away, and nobody is ever inside it. `Extraction` flies the one the
 * player BOARDS, and the player's note is the whole reason those cannot be the
 * same hull: "the transports are closed at the sides, you can't see yourself or
 * your troops it's completely blocked". A gunship's bay is a dark plate between
 * two rails — see `buildGunship` — with no aperture and no interior, because it
 * never needed one.
 *
 * `buildTransport` has a bay you stand in, a ramp, two sliding doors and two
 * pilots. It is more than twice the ship in every sense including cost, and
 * exactly one is ever in the world at a time, which is what makes that
 * affordable. `Levels.js` registers both, from the same place, for the reason
 * the note above gives about the direction of the import.
 */
let _transportModel = null;
export function setTransportModel(fn) { _transportModel = typeof fn === 'function' ? fn : null; }

/** And the capital ship the insertion leaves. Same seam, same reason. */
let _capitalModel = null;
export function setCapitalModel(fn) { _capitalModel = typeof fn === 'function' ? fn : null; }
export function capitalModel(side) {
  if (!_capitalModel) return null;
  try { return _capitalModel({ side }); } catch (e) { return null; }
}

/**
 * THE SAME SHIP, FOR THE ONE THING THAT IS NOT AN ARRIVAL.
 *
 * `src/game/Extraction.js` flies the transport the player BOARDS, and it needs
 * the identical hull — a departure that left on a different craft from the one
 * that brought the enemy in would read as two games. It cannot import
 * `Vehicles.js` for the reason the note above gives, and it must not hold a
 * second injection point, because two registries for one model is exactly the
 * hand-maintained twin HANDOFF 2.4 is about. So the injected builder is
 * readable, and `Levels.js` still registers it exactly once.
 *
 * Returns null when nothing is registered, which is every headless check that
 * does not import `Levels.js`; the caller falls back to primitives.
 */
export function dropshipModel(side) {
  if (!_shipModel) return null;
  /* `side` IS PASSED ON RATHER THAN BRANCHED ON — the same rule the transport
   * door below states in full. There are two gunships now and this file
   * resolves neither: `Vehicles.js` owns the table, and a lookup here would be
   * a second copy of it (HANDOFF §2.3). */
  try { return _shipModel({ side }); } catch (e) { return null; }
}

/**
 * The transport, for `Extraction`. Falls back to the gunship rather than to
 * primitives when nothing is registered — a check that has imported Vehicles
 * but not Levels still gets a hull — and to null after that, which is every
 * headless suite and which the director already handles.
 *
 * ── `side` IS THE ONLY ARGUMENT, AND IT IS PASSED ON RATHER THAN BRANCHED ON
 *
 * The player, having played a Sith: "sith side still gets picked up by the
 * same transports that belong to the republic canonically". There are two
 * hulls now and this file resolves neither of them — it hands the army id
 * through to the registered builder and lets `Vehicles.js` pick, because that
 * is where the hulls are and because a lookup here would be the second copy of
 * a table that already exists there (HANDOFF §2.3). An `undefined` side is a
 * legal call and gets whatever the builder's own default is, which is what
 * every headless check that asks for a hull without a world will do.
 *
 * The gunship fallback ignores it. That is correct rather than sloppy: the
 * fallback exists for a tree with no transport registered at all, and a
 * faction-correct hull is not something it can offer.
 */
export function transportModel(side) {
  for (const fn of [_transportModel, _shipModel]) {
    if (!fn) continue;
    try { const m = fn({ side }); if (m) return m; } catch (e) { /* try the next */ }
  }
  return null;
}

const rng = makeRng(20931);

/**
 * Seeded from the run, exactly as `Waves.seedWaves` is — see WaveDirector's
 * constructor, which calls this beside the enemy and duel streams.
 *
 * `Run.seed` is documented as "the seed EVERYTHING random in this run derives
 * from", and this was the last stream still outside it: which craft arrives,
 * where it sets down, which bearing it comes in on and how the squad spills
 * out of it were all off a module-load constant. So a seeded Descent replayed
 * its waves and its choreography and then had different things fly in — and
 * only on the FIRST run after a page load, because the stream is never reset
 * and every later run inherits wherever the previous one left it.
 */
export function seedArrivals(seed) { rng.seed(seed); }
let _arrivalId = 1;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How long an arrival must have been standing in the world before it is
 * allowed to put a body on the ground. Three seconds is about a breath and a
 * half: long enough to look up, turn, and decide where you would rather be
 * standing when it opens.
 */
export const ARRIVAL_LEAD = 2.4;

/**
 * How far out a marching body starts, as a multiple of the level's own outer
 * spawn ring. 1.45 puts it at 45–90 m depending on the level, which is past
 * the LOD-2 threshold (62 m) on the wider ones and reads as a shape on the
 * skyline rather than a droid.
 *
 * IT IS A MULTIPLE AND THEREFORE NOT A DISTANCE, which is the whole of the
 * defect `marchBand` exists to close — see below.
 */
export const MARCH_RADIUS = 1.45;

/**
 * How much wider the band's far edge is than its near one.
 *
 * This was a bare `1.14` written out at three call sites, one of which is
 * `deliveryIsAnnounced` — i.e. the rule and its own test each carried their
 * own copy of the number. There is one now, and `marchBand` is the only place
 * it is applied.
 */
export const MARCH_SPREAD = 1.14;

/**
 * WHERE A MARCH MAY BE PUT DOWN — near edge and far edge, in metres.
 *
 * ── THE FLOOR is `ring × MARCH_RADIUS`, and it is load-bearing for the reason
 * `_sitePoint` gives: a body that simply appears and walks is an acceptable
 * arrival ONLY because it appears beyond the ring everything else spawns at.
 *
 * ── THE CEILING IS THE PART THAT WAS MISSING, and it is the rule this whole
 * function exists to state:
 *
 *     A BODY MUST NEVER BE PLACED BEYOND THE DISTANCE AT WHICH IT STOPS
 *     DRAWING ITSELF.
 *
 * `Cohorts.L3_AT` is that distance — 137.8 m, itself derived from the far
 * plane the ink prepass gives its own camera. Past it `Enemy._lod` hands the
 * body to the cohort field: no outline, no own mesh, one shared pose. IMPORTED
 * FROM THE MODULE THAT OWNS IT rather than retyped, so moving `INK.edgeFade`
 * moves this bound with it.
 *
 * What it cost to not have it: geonosis' `spawnRadius` is `[58, 96]`, the
 * widest ring in the game by a factor of 1.6, and `96 × 1.45 × 1.14` is 158.7 m.
 * Every hostile on that level was BORN OUTLINE-LESS, 21 m past the distance the
 * renderer stops treating it as a body, in the thickest fog in the game, and
 * then walked 30–45 s to get into view. Measured in Command at 50 s: median
 * hostile range 110.9 m, 32 of 49 outside the frustum. Nothing about geonosis
 * was wrong except that its ring is big, which is its premise — so the fix
 * belongs here, at the placement, and not in that level's table. The next map
 * with a wide ring gets it for free.
 *
 * Measured furthest arrival per level over waves 4–16, before → after, with
 * `tools/checks/arrivals.mjs` printing the same table: scoria 69.6, mustafar
 * 85.6, colosseum 82.2, wood 76.0, drifts 99.2, alpine 84.9 — all unchanged,
 * all already inside 137.8 — and geonosis 158.2 → 137.4. Six of seven levels
 * are untouched because the clamp only bites where the band already reached
 * past the renderer. 137.4 is the headless number, at `setback` 0; in game the
 * boom takes the same placement to 134.7.
 *
 * @param ring     the level's own outer spawn radius
 * @param setback  how far the camera sits behind the anchor these distances are
 *                 measured from; see `ArrivalDirector._setback`
 * @returns [near, far] in metres, `far <= L3_AT - setback` always
 */
export function marchBand(ring, setback = 0) {
  const cap = Math.max(L3_AT - setback, 1);
  /* The band is SCALED down rather than clipped: clipping `far` alone against
   * a `near` already past the cap would invert the two, and `lerp(rMin, rMax)`
   * with rMin > rMax draws points outside both. */
  const far = Math.min(ring * MARCH_RADIUS * MARCH_SPREAD, cap);
  return [Math.min(ring * MARCH_RADIUS, far / MARCH_SPREAD), far];
}

/** Ships and gates in flight at once. Three is a busy sky; four is a queue. */
export const MAX_CONCURRENT = 3;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Shared geometry and materials — built once, for every arrival ever    */
/* ══════════════════════════════════════════════════════════════════════ */

const G = {};
const M = {};
let _built = false;

function build() {
  if (_built) return;
  _built = true;

  // ── dropship
  // Sized for the range it is actually seen at. A ship delivers at roughly
  // 0.82 of the level's outer spawn ring — 44 to 57 m on the dune sea — and the
  // first pass at 5.6 m long subtended about 7° there, which reads as a bird.
  // 8 m long with a 10 m span is a gunship: big enough to be a machine at
  // fifty metres, small enough that four of them are not the skyline.
  G.hull = new THREE.BoxGeometry(2.7, 1.55, 7.6);
  G.nose = new THREE.ConeGeometry(1.45, 3.0, 4);
  G.nose.rotateX(-Math.PI / 2);
  G.wing = new THREE.BoxGeometry(4.6, 0.3, 2.3);
  G.nacelle = new THREE.CylinderGeometry(0.57, 0.68, 2.6, 8);
  G.nacelle.rotateX(Math.PI / 2);
  G.strut = new THREE.BoxGeometry(0.24, 1.2, 0.24);
  G.glow = new THREE.SphereGeometry(0.46, 8, 6);
  // the light a ship throws down at a landing zone: a wide, soft cone
  G.wash = new THREE.ConeGeometry(4.6, 8.0, 16, 1, true);
  G.wash.translate(0, -4.0, 0);

  // ── gate
  G.pillar = new THREE.BoxGeometry(0.9, 5.0, 1.3);
  G.lintel = new THREE.BoxGeometry(6.4, 1.0, 1.5);
  G.leaf = new THREE.BoxGeometry(2.35, 4.3, 0.42);
  G.dark = new THREE.PlaneGeometry(4.7, 4.3);
  G.strip = new THREE.BoxGeometry(4.7, 0.09, 0.1);

  const solid = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.35, ...opts,
  });
  M.hull = solid(0x4a5058, { roughness: 0.62, metalness: 0.55 });
  M.trim = solid(0x2a2e34, { roughness: 0.5, metalness: 0.7 });
  M.stone = solid(0x8d7f66, { roughness: 0.95, metalness: 0.02 });
  M.panel = solid(0x565d68, { roughness: 0.55, metalness: 0.65 });
  M.dark = new THREE.MeshBasicMaterial({ color: 0x05070a, toneMapped: false });
  M.engine = new THREE.MeshBasicMaterial({
    color: 0x6fd0ff, toneMapped: false, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false });
  M.lamp = new THREE.MeshBasicMaterial({
    color: 0xffcf88, toneMapped: false, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false });
  M.wash = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, toneMapped: false, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  M.strip = new THREE.MeshBasicMaterial({
    color: 0xff6a4a, toneMapped: false, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false });
}

const mesh = (g, m, parent) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; parent.add(o); return o; };

/* ══════════════════════════════════════════════════════════════════════ */
/*  Which arrival a level gets                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Levels are grouped by what an arrival can physically be in them, which is
 * the only thing that matters here: an open sky takes a ship, a walled bowl
 * takes a door in the wall, and an interior takes a bay door.
 *
 * Keyed by the level's own `terrain` string rather than its display name, so a
 * new level built on an existing terrain inherits the right arrival instead of
 * silently falling through to the default.
 */
export const ARRIVAL_BY_TERRAIN = {
  // Two ships to one march on the open levels: a march is honest but it is
  // also 80–100 m of walking before the body is in the fight, and a wave made
  // mostly of them is a wave you spend watching. Weighted by repetition rather
  // than by a probability table so the whole model is one literal you can read.
  drifts: ['dropship', 'dropship', 'march'],
  alpine: ['dropship', 'dropship', 'march'],
  /* THREE KEYS ARE GONE: `dunes`, `canyon` and `hangar`. They described the
   * dune sea, the wash and Hangar Bay Nine, all three deleted from LEVELS at
   * the player's request — so this table, whose whole job is to answer "how
   * does the enemy get onto THIS ground", was three fifths a description of
   * ground that does not exist. `hangar` was also the only `['gate']` entry
   * here, which made "the game can still open a gate" a fact about a deleted
   * level; the Colosseum registers the real one from Levels.js.
   *
   * They were not merely stale, they were UNREACHABLE-AND-UNTESTABLE: keyed by
   * a terrain string no level declares, nothing could ever draw from them, and
   * no check could ever fail on them being wrong. That is the shape §2.3 is
   * about — a row that cannot be wrong is a row that is not right either.
   *
   * The keys cannot be derived from LEVELS here: `Spawn.js` records why this
   * module must not import `Levels.js` back (Levels.js imports this table to
   * register its own grounds into it). So the derivation is done in the one
   * place that can see both tables at once — `tools/checks/arrivals.mjs` now
   * asserts BOTH directions, every level has an entry AND every entry has a
   * level, which is what stops the next deleted ground leaving a row here. */
};

/** Bodies too big to fit in anything: they walk. */
const walksIn = (A) => !!(A && (A.big || A.boss));

/**
 * Pick the arrival for one body.
 * @param level  the LEVELS entry (needs `terrain`; `sky:false` marks interiors)
 * @param A      the archetype
 */
export function arrivalKindFor(level, A, roll = rng) {
  if (walksIn(A)) return 'march';
  const kinds = ARRIVAL_BY_TERRAIN[level?.terrain] || ['march'];
  // A gate level has no sky to fly a ship through, so its list is a single
  // entry and this returns it every time; open levels alternate.
  return kinds[Math.floor(roll() * kinds.length) % kinds.length];
}

/** How many bodies one arrival of this kind carries. */
export function capacityOf(kind) {
  return kind === 'dropship' ? 4 : kind === 'gate' ? 5 : 1;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  One arrival                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

class Arrival {
  /**
   * @param world    the World (scene, terrain, particles, groundColor)
   * @param kind     'dropship' | 'gate' | 'march'
   * @param at       where the bodies are to be delivered, on the ground
   * @param toward   the point the arrival should face (the player)
   * @param parent   the director's persistent group
   */
  constructor(world, kind, at, toward, parent) {
    build();
    this.world = world;
    this.kind = kind;
    this.id = 'a' + (_arrivalId++);
    this.at = at.clone();
    this.age = 0;
    this.done = false;
    this.manifest = [];        // { type, mod }
    this.delivered = 0;
    this.releaseTimer = 0;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    parent.add(this.group);

    this.yaw = Math.atan2(toward.x - at.x, toward.z - at.z);
    if (kind === 'dropship') this._makeDropship();
    else if (kind === 'gate') this._makeGate();
    else this._makeMarch();
  }

  /* `capOverride` is the Command mode's reinforcement flight and nothing
   * else. A wave's gunship carries four because four droids spilling out is
   * the read; a LAAT bringing your own squad down between areas carries the
   * squad, and at four a thirteen-man roster took three round trips and
   * twelve seconds to finish arriving. */
  get capacity() { return this.capOverride ?? capacityOf(this.kind); }
  get full() { return this.manifest.length >= this.capacity; }
  get pending() { return this.manifest.length - this.delivered; }
  /** Seconds before this arrival will put its first body down. */
  get openAt() { return this.kind === 'dropship' ? 3.6 : this.kind === 'gate' ? 2.6 : 0; }

  /* `onBody` is the seam the Command mode needs and nothing else uses: a
   * trooper record has to be welded to the Enemy the ship puts down, and only
   * the caller knows which record goes with which slot. Kept per SLOT rather
   * than per flight, because a gunship carries four and a squad of four is
   * four different named people. */
  add(type, mod, onBody = null) { this.manifest.push({ type, mod, onBody }); }

  /* ── the ship ──────────────────────────────────────────────────────── */

  _makeDropship() {
    const g = this.group;
    /**
     * IT IS A GUNSHIP NOW, AND IT WAS A BOX BEFORE.
     *
     * What stood here was seven primitives — a box, a four-sided cone, two
     * boxes for wings, two cylinders and two glows — sized honestly against the
     * range it is seen at (see the note above `G.hull`) and reading, at fifty
     * metres, as a dart. The reference plates the Command mode was built from
     * have a LAAT/i in almost every frame of this battle, and the vehicles lane
     * modelled one: swept-forward wings with wingtip pods and rocket racks,
     * dorsal cone nacelles, chin ball turrets, gunner bubbles on outriggers and
     * an open troop bay with clones standing in it.
     *
     * NOTHING ABOUT THE FLIGHT PATH MOVES, and that is why this is four lines
     * rather than a retune. `buildGunship` is written to the box's own contract:
     * the nose is at −Z (the direction `_updateDropship` flies and the direction
     * `G.nose` pointed), and it measures 10.9 × 3.7 × 7.4 m against the box's
     * 10.0 × 1.55 × 7.6 — so every range, lead time and flare this director was
     * tuned at is unchanged.
     *
     * The two animated meshes are PARENTED rather than re-placed: `_fireL`,
     * `_fireR` and `_lamp` are written every frame by `_updateDropship`, and the
     * model publishes anchors for exactly them (`userData.engines`,
     * `userData.lamp`) so the flare and the strobe end up on the real nacelles
     * and under the real nose instead of at coordinates that used to be right.
     *
     * The primitive geometries stay in `G` and are still used by the gate; the
     * fallback below is not decoration either — a level must never fail to
     * produce its wave, and a model that throws must not take the arrival with
     * it.
     */
    /**
     * WHOSE GUNSHIP IS THIS? THE ENEMY'S — and it used to be everybody's.
     *
     * This ship delivers the WAVE, so it belongs to whoever the wave belongs
     * to, which is the army the player is not leading. Before this there was
     * one hull and both sides flew it: a Jedi's droid enemies came down out of
     * a Republic gunship, which is the player's own complaint about transports
     * ("sith side still gets picked up by the same transports that belong to
     * the republic canonically") pointed at the other player and one scene
     * over. The lane that gave the Confederacy a transport left this seam
     * ready and said so.
     *
     * `armyForOrder` is the same single statement of the mapping that
     * `Command.sideForOrder` and `WaveDirector.myArmy` both read; `opposingArmy`
     * is the other side of the war. A Grey leads neither, so `opposingArmy`
     * answers null and the builder's own default hull arrives — which is
     * correct rather than lazy: there is no side to be wrong about.
     */
    const mine = armyForOrder(this.world?.settings?.order ?? null);
    const foe = opposingArmy(mine);
    let ship = null;
    try { ship = _shipModel ? _shipModel({ side: foe }) : null; } catch (e) { ship = null; }
    if (ship) {
      g.add(ship);
      this._model = ship;
      const anchors = ship.userData?.engines || [];
      const lampAt = ship.userData?.lamp || null;
      for (let i = 0; i < 2; i++) {
        const fire = new THREE.Mesh(G.glow, M.engine);
        fire.frustumCulled = false;
        fire.scale.set(0.8, 0.8, 1.5);
        const host = anchors[i];
        if (host) host.add(fire);
        else { fire.position.set((i ? 1 : -1) * 4.5, -0.22, 2.6); g.add(fire); }
        this[i ? '_fireR' : '_fireL'] = fire;
      }
      const lamp = new THREE.Mesh(G.glow, M.lamp);
      lamp.frustumCulled = false;
      lamp.scale.setScalar(0.45);
      if (lampAt) lampAt.add(lamp); else { lamp.position.set(0, -0.7, -3.8); g.add(lamp); }
      this._lamp = lamp;
      this._makeWash(g);
      return this._flightPath();
    }
    const hull = mesh(G.hull, M.hull, g);
    hull.castShadow = true;
    const nose = mesh(G.nose, M.hull, g); nose.position.z = -4.9;
    for (const s of [-1, 1]) {
      const w = mesh(G.wing, M.trim, g);
      w.position.set(s * 3.2, -0.14, 0.95);
      w.rotation.z = s * 0.16;
      const n = mesh(G.nacelle, M.trim, g);
      n.position.set(s * 4.5, -0.22, 1.2);
      const fire = mesh(G.glow, M.engine, g);
      fire.position.set(s * 4.5, -0.22, 2.6);
      fire.scale.set(0.8, 0.8, 1.5);
      this[`_fire${s > 0 ? 'R' : 'L'}`] = fire;
      const strut = mesh(G.strut, M.trim, g);
      strut.position.set(s * 1.35, -1.3, 1.9);
    }
    const lamp = mesh(G.glow, M.lamp, g);
    lamp.position.set(0, -0.7, -3.8);
    lamp.scale.setScalar(0.45);
    this._lamp = lamp;

    this._makeWash(g);
    this._flightPath();
  }

  /** The light and the dust the ship throws at the ground while it hovers. */
  _makeWash(g) {
    this._wash = new THREE.Mesh(G.wash, M.wash.clone());
    this._wash.frustumCulled = false;
    this._wash.renderOrder = 6;
    g.add(this._wash);
  }

  /**
   * In from beyond the ring, high and fast, flaring to a hover over the drop
   * point. Lifted out of `_makeDropship` when the hull became a choice between
   * a model and the primitives — the PATH is the same for both, and a second
   * copy of it in the model branch is the shape §2.4 of the handover is about.
   */
  _flightPath() {
    const away = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    this.hover = this.at.clone().setY(this.at.y + 5.6);
    this.start = this.at.clone().addScaledVector(away, 88).setY(this.at.y + 38);
    this.exit = this.at.clone().addScaledVector(away, -70).setY(this.at.y + 46);
    this.group.position.copy(this.start);
    audio.noise({ dur: 2.6, gain: 0.09, type: 'bandpass', freq: 260, q: 0.9, pos: this.start });
  }

  _updateDropship(dt, ctx) {
    const t = this.age;
    const g = this.group;
    const IN = 3.6;                                  // arrive
    const out = IN + 0.35 * this.manifest.length + 0.9;
    if (t < IN) {
      // ease in and flare: fast and high, then slow and low
      const k = smoothstep(0, 1, t / IN);
      g.position.lerpVectors(this.start, this.hover, k * k * (3 - 2 * k));
      g.position.y = lerp(this.start.y, this.hover.y, smoothstep(0, 1, Math.pow(k, 0.72)));
    } else if (t < out) {
      // hold, with the small drift a hovering thing has
      g.position.x = damp(g.position.x, this.hover.x, 3, dt);
      g.position.z = damp(g.position.z, this.hover.z, 3, dt);
      g.position.y = this.hover.y + Math.sin(t * 2.6) * 0.10;
    } else {
      const k = clamp((t - out) / 3.4, 0, 1);
      g.position.lerpVectors(this.hover, this.exit, k * k);
      if (k >= 1) this.done = true;
    }
    // nose into the flight direction, level over the pad
    const banking = t < IN ? clamp((IN - t) / IN, 0, 1) * 0.35 : 0;
    g.rotation.set(banking * 0.6, this.yaw + Math.PI, 0);

    const low = 1 - clamp((g.position.y - this.at.y) / 16, 0, 1);
    const w = this._wash;
    w.position.set(0, -0.8, 0);
    w.material.opacity = low * 0.16;
    w.scale.setScalar(lerp(0.55, 1, low));
    const flare = 0.8 + Math.sin(t * 31) * 0.12;
    if (this._fireL) this._fireL.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);
    if (this._fireR) this._fireR.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);
    // A strobe under the nose, because at fifty metres against a bright sky the
    // hull is a silhouette and a blinking light is the thing the eye catches.
    if (this._lamp) this._lamp.scale.setScalar(0.45 * (Math.sin(t * 8) > 0 ? 1.35 : 0.5));

    // sand off the pad while it is down
    if (low > 0.5 && ctx.particles && rng() < 0.5) {
      const a = rng() * TAU, r = 1.2 + rng() * 2.6;
      _v2.set(this.at.x + Math.cos(a) * r, this.at.y, this.at.z + Math.sin(a) * r);
      ctx.particles.sandPuff(_v2.clone(), 0.5 + rng() * 0.5, this.at.y, this.world.groundColor);
    }
    return t >= IN && t < out;
  }

  /** Where a dropship puts a body: under its belly, in the air. */
  _dropPoint(out) {
    return out.copy(this.group.position).setY(this.group.position.y - 1.9);
  }

  /* ── the gate ──────────────────────────────────────────────────────── */

  _makeGate() {
    const g = this.group;
    g.position.copy(this.at);
    g.rotation.y = this.yaw;
    const interior = this.world.level?.atmosphere?.sky === false;
    const body = interior ? M.panel : M.stone;
    for (const s of [-1, 1]) {
      const p = mesh(G.pillar, body, g);
      p.position.set(s * 2.85, 2.5, 0);
      p.castShadow = true;
    }
    const lintel = mesh(G.lintel, body, g);
    lintel.position.set(0, 5.4, 0);
    lintel.castShadow = true;
    // the dark behind the doors, so an open gate reads as a way IN somewhere
    const dark = mesh(G.dark, M.dark, g);
    dark.position.set(0, 2.15, -0.3);
    this._leaves = [];
    for (const s of [-1, 1]) {
      const l = mesh(G.leaf, interior ? M.panel : M.trim, g);
      l.position.set(s * 1.175, 2.15, 0);
      l.castShadow = true;
      this._leaves.push(l);
    }
    // the warning light over a door that is about to open
    const strip = mesh(G.strip, M.strip, g);
    strip.position.set(0, 4.55, 0.35);
    audio.noise({ dur: 1.8, gain: 0.13, type: 'lowpass', freq: 180, q: 0.7, pos: this.at });
  }

  _updateGate(dt, ctx) {
    const t = this.age;
    const OPEN = 1.1, WIDE = 2.6;
    const shut = WIDE + 0.5 * this.manifest.length + 1.4;
    let k;
    if (t < OPEN) k = 0;                                        // rumble first
    else if (t < WIDE) k = smoothstep(0, 1, (t - OPEN) / (WIDE - OPEN));
    else if (t < shut) k = 1;
    else k = 1 - smoothstep(0, 1, clamp((t - shut) / 1.3, 0, 1));
    if (this._leaves) {
      this._leaves[0].position.x = -1.175 - k * 1.62;
      this._leaves[1].position.x = 1.175 + k * 1.62;
    }
    // the dust a heavy door shakes loose
    if (t < WIDE && ctx.particles && rng() < 0.35) {
      _v2.set(this.at.x + (rng() - 0.5) * 5.4, this.at.y, this.at.z);
      ctx.particles.sandPuff(_v2.clone(), 0.3, this.at.y, this.world.groundColor);
    }
    if (t > shut + 1.6) this.done = true;
    return t >= WIDE && t < shut;
  }

  /** Where a gate puts a body: in the doorway, on its feet. */
  _gatePoint(out) {
    return out.copy(this.at).addScaledVector(
      _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.8);
  }

  /* ── the long walk ─────────────────────────────────────────────────── */

  _makeMarch() {
    // Nothing is built. The body IS the arrival: it is put down beyond the
    // ring anything is normally spawned at and walks the whole way in, which
    // is the one arrival that needs no vehicle to be honest.
    this.group.visible = false;
  }

  _updateMarch() {
    if (this.delivered >= this.manifest.length) this.done = true;
    return true;
  }

  /* ── the frame ─────────────────────────────────────────────────────── */

  update(dt, ctx, deliver) {
    this.age += dt;
    const open = this.kind === 'dropship' ? this._updateDropship(dt, ctx)
               : this.kind === 'gate' ? this._updateGate(dt, ctx)
               : this._updateMarch(dt, ctx);
    if (!open || this.delivered >= this.manifest.length) return;

    this.releaseTimer -= dt;
    if (this.releaseTimer > 0) return;
    this.releaseTimer = this.kind === 'dropship' ? 0.35 : this.kind === 'gate' ? 0.5 : 0;

    const slot = this.manifest[this.delivered];
    const point = this.kind === 'dropship' ? this._dropPoint(_v1)
                : this.kind === 'gate' ? this._gatePoint(_v1)
                : _v1.copy(this.at);
    const e = deliver(slot.type, slot.mod, point, this);
    this.delivered++;
    if (!e) return;
    // …and whoever asked for this body gets it before anything else touches it.
    slot.onBody?.(e, this);

    if (this.kind === 'dropship') {
      // dropped, not placed: it falls the last few metres and lands on its own
      // feet, with the same puff every other hard landing in the game makes
      e.position.copy(point);
      e.grounded = false;
      e.velocity.set((rng() - 0.5) * 1.2, -1.5, (rng() - 0.5) * 1.2);
      e.facing = this.yaw;
      audio.thud(point, 0.5);
    } else if (this.kind === 'gate') {
      e.facing = this.yaw;
    }
  }

  remove() {
    this.group.parent?.remove(this.group);
    // The one per-arrival allocation in the file: the wash cone's opacity is
    // animated, so it cannot be the shared material. It goes with the arrival.
    this._wash?.material.dispose();
    this._wash = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The director                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

export class ArrivalDirector {
  /**
   * @param world  the World
   * @param spawn  (type, mod, position) => Enemy — the ONE door into the game,
   *               kept as a callback so this file never has to know about
   *               World.spawnEnemy or the modifier table.
   * @param archetypes  the ARCHETYPES table, passed in for the same reason and
   *               taken once rather than spread into a fresh ctx every frame.
   */
  constructor(world, spawn, archetypes = {}) {
    this.world = world;
    this.spawn = spawn;
    this.archetypes = archetypes;
    this.flights = [];
    this.staging = [];
    /** Every body ever put down, and how it was announced. See the invariant. */
    this.log = [];
    this.enabled = true;
    this.group = new THREE.Group();
    this.group.name = 'arrivals';
    this.group.frustumCulled = false;
    world.scene?.add(this.group);
    // World.unload empties `statics` out of the scene; parking the group there
    // is how an arrival in flight when a level ends stops being in the next one.
    world.statics?.push(this.group);
  }

  /** Bodies queued or in the air — a wave is not clear while this is nonzero. */
  get pending() {
    let n = this.staging.length;
    for (const f of this.flights) n += f.pending;
    return n;
  }

  /**
   * Ask for one body. It is delivered later, by something you can watch.
   * Returns false if arrivals are off, in which case the caller spawns
   * directly — a level with no arrival for its terrain still has to work.
   *
   * `bearing` is a radian heading the caller wants the delivery to come in on,
   * or null for the uniform draw every arrival has always used. It exists for
   * `CONDITIONS.hammer` in Waves.js — a wave that arrives from one quarter, so
   * the field has a front — and it is honoured for the SITE only: which ship
   * comes, how it flies and how the squad spills out are unchanged. A flight is
   * only reused for another body with the same bearing, or a bearing wave would
   * pick up a ship already inbound from the far side.
   */
  request(type, mod = null, bearing = null, arc = Math.PI / 2, onBody = null, opts = {}) {
    if (!this.enabled) return false;
    /* `kind` and `near` OVERRIDE THE LEVEL'S TABLE, and there is exactly one
     * caller: your own reinforcements at an area boundary. `ARRIVAL_BY_TERRAIN`
     * answers "how does the ENEMY get onto this ground" — which on Geonosis is
     * mostly a march, deliberately, because the walk across the plain is the
     * point of the place. Your gunships are not answering that question. They
     * land, in the open, next to you, which is what the mode's own first brief
     * describes; drawn from the same table they walked in from 134 m and the
     * area started without them. */
    this.staging.push({ type, mod, bearing, arc, onBody, kind: opts.kind || null,
      near: opts.near ?? null, cap: opts.cap ?? 0 });
    return true;
  }

  /** How far out the level puts things, and therefore how far out a march is. */
  _ring() {
    const [, rmax] = this.world.level?.spawnRadius || [34, 56];
    return rmax;
  }

  /**
   * WHERE THE ARRIVALS ARE MEASURED FROM — and it is not always the player.
   *
   * Every distance in this file is the player's, which is right for all of the
   * game except the half-minute at the start of it. `World` releases the wave
   * director on the gunship's DESCENT now, so the enemy is on the ground and
   * walking in before the ramp comes down — but for that whole fall the player
   * is a seat in a bay, and measured on geonosis the bay is 150 m downrange of
   * the pad at the top of the fall and 39 m with two seconds left.
   *
   * Anchored there, the ring is drawn around a moving aeroplane: 13 of the
   * first 25 bodies stood past `Cohorts.L3_AT`, which is the born-outline-less
   * defect `marchBand` exists to have ended. `World.holdsHorde` bought the time
   * back by waiting until the ship's ground track was inside the level's own
   * spawn ring, and that costs about four seconds of the nine-second fall.
   *
   * So while the commander is riding, the anchor is THE PLACE THE SHIP IS
   * AIMED AT. That is what the whole flight is about, it does not move, and it
   * is where the player will be standing when any of this matters. The wave
   * can then be called from the top of the descent instead of most of the way
   * down it.
   */
  /**
   * Does this director measure from the landing zone rather than the player?
   *
   * Asked by `ExtractionDirector.holdsHorde` so it can release the wave at the
   * top of the descent instead of most of the way down it. A capability, read
   * off the object that has it, rather than a version number two files agree
   * about by hand.
   */
  get anchorsOnLz() { return !!(this.world?.player?.riding && this.world?.extraction?.lzPoint); }

  _anchor(out) {
    const w = this.world;
    const p = w.player;
    const lz = p?.riding ? w.extraction?.lzPoint : null;
    if (lz) return out.copy(lz);
    return out.copy(p ? p.position : _v3.set(0, 0, 0));
  }

  /**
   * How far behind the anchor the camera is, in metres.
   *
   * WHY THIS EXISTS AND IS NOT ZERO. Every distance in this file is measured
   * from the PLAYER — `_anchor` — and the threshold `marchBand` clamps against
   * is measured from the CAMERA: `Enemy._lod` is
   * `ctx.camera.position.distanceTo(this.position) > L3_AT`. In third person
   * those differ by the boom, so a body placed at exactly `L3_AT` from the
   * player and standing in front of them is past `L3_AT` from the camera and
   * is instanced anyway — the clamp would be 3 m short of the thing it claims.
   *
   * Read off the rig that will actually run that test rather than typed here:
   * `CameraRig.distance` is the boom's unoccluded length (3.05 m walking, 5.1 m
   * on the death cam, 0 in first person, where the camera IS the anchor and the
   * setback is genuinely zero). A fixture with no rig gets 0, which leaves the
   * bound at exactly `L3_AT` — that is the weakest form of the rule and the one
   * the check measures, so the shipped game is strictly inside what is asserted.
   */
  _setback() {
    return this.world.player?.camera?.distance || 0;
  }

  /** Ground a point on the level's own terrain. */
  _ground(p) {
    const t = this.world.terrain;
    p.y = t ? t.height(p.x, p.z) : 0;
    return p;
  }

  /**
   * A landing site between two radii.
   *
   * The band is a MINIMUM and a maximum rather than a centre and a jitter,
   * because for a march the minimum is load-bearing: the whole reason a body
   * that simply appears and walks is an acceptable arrival is that it appears
   * beyond the ring anything else is spawned at. A symmetric jitter around
   * `ring × MARCH_RADIUS` put a quarter of them back inside it — measured, at
   * 77.6 m against an 80.9 m floor — and those are exactly the ones that read
   * as popping in.
   */
  _sitePoint(rMin, rMax, out, bearing = null, arc = Math.PI / 2) {
    const t = this.world.terrain;
    this._anchor(out);
    const ax = out.x, az = out.z;
    for (let i = 0; i < 20; i++) {
      /* A bearing narrows the draw to one quarter of the compass instead of
       * replacing it, so every rejection test below still runs and a site that
       * fails them all still falls back to the full circle. See `request`. */
      const a = bearing === null ? rng() * TAU
        : bearing + (rng() - 0.5) * arc;
      const r = lerp(rMin, rMax, rng());
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      if (t && !t.inBounds(x, z, 10)) continue;
      if (t && t.slopeAt && t.slopeAt(x, z) > 0.5) continue;
      /* …and whatever the LEVEL put on the ground. This tested terrain alone,
       * exactly as World.pickSpawn used to, so a landing craft could set a
       * squad down inside a column or under a lava sheet — measured at 11.9%
       * of temple picks and 94.3% of the deeps'. See Spawn.js. */
      if (!spawnClear(this.world, x, t ? t.height(x, z) : 0, z)) continue;
      /* …AND NEVER INSIDE A LIT BLADE. `near` is 18 m for the Command mode's
       * own reinforcement flight, so in practice a landing site is far outside
       * a swing — but "in practice" is how a placement rule stops being one.
       * The player's second complaint was allies delivered into the arc; this
       * is the door every delivered body in the game comes through, so it is
       * where the law belongs rather than at whichever caller happens to be
       * close today. See Spawn.js. */
      if (!bladeClear(this.world, x, z)) continue;
      return this._ground(out.set(x, 0, z));
    }
    const a = rng() * TAU;
    return this._ground(out.set(ax + Math.cos(a) * rMin, 0, az + Math.sin(a) * rMin));
  }

  _open(kind, A, bearing = null, arc = Math.PI / 2, near = null, cap = 0) {
    const anchor = this._anchor(new THREE.Vector3());
    const ring = this._ring();
    const [mNear, mFar] = marchBand(ring, this._setback());
    const at = near !== null
      ? this._sitePoint(near * 0.55, near, new THREE.Vector3(), bearing, arc)
      : kind === 'march'
        ? this._sitePoint(mNear, mFar, new THREE.Vector3(), bearing, arc)
        /* A ship and a gate land at 0.72–0.94 of the ring, i.e. INSIDE it, so
         * they cannot reach the ceiling `marchBand` exists to hold — a level
         * would have to declare a 147 m outer ring first, and its own spawns
         * would already be past the renderer by then. The check asserts this
         * over every level rather than trusting the arithmetic here. */
        : this._sitePoint(ring * 0.72, ring * 0.94, new THREE.Vector3(), bearing, arc);
    const f = new Arrival(this.world, kind, at, anchor, this.group);
    f.bearing = bearing;
    f.near = near;
    if (cap) f.capOverride = cap;
    this.flights.push(f);
    return f;
  }

  update(dt, ctx) {
    // fill flights from the staging list
    while (this.staging.length && this.flights.filter(f => !f.done).length < MAX_CONCURRENT) {
      const slot = this.staging[0];
      const A = this.archetypes[slot.type];
      const kind = slot.kind || arrivalKindFor(this.world.level, A, rng);
      // an existing flight of the right kind with room takes it, so a squad
      // rides in together instead of one ship per droid
      const want = slot.bearing ?? null;
      let f = this.flights.find(x => !x.done && x.kind === kind && !x.full && x.age < x.openAt * 0.6
        && (x.bearing ?? null) === want && (x.near ?? null) === (slot.near ?? null));
      if (!f) f = this._open(kind, A, want, slot.arc ?? Math.PI / 2, slot.near ?? null, slot.cap ?? 0);
      f.add(slot.type, slot.mod, slot.onBody);
      this.staging.shift();
    }

    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.update(dt, ctx, (type, mod, point, arrival) => this._deliver(type, mod, point, arrival));
      if (f.done) { f.remove(); this.flights.splice(i, 1); }
    }
  }

  _deliver(type, mod, point, arrival) {
    const e = this.spawn(type, mod, point);
    const anchor = this._anchor(_v2);
    this.log.push({
      kind: arrival.kind,
      flight: arrival.id,
      lead: arrival.age,
      dist: Math.hypot(point.x - anchor.x, point.z - anchor.z),
      type,
    });
    if (this.log.length > 200) this.log.shift();
    return e;
  }

  /**
   * PUT A BODY THAT IS SOMEWHERE IMPOSSIBLE SOMEWHERE POSSIBLE.
   *
   * The recovery half of player note #7 — a body inside geometry or outside the
   * heightfield blocks a wave forever, and `WaveDirector._rescue` is what
   * notices. This is what it does about it, and it lives here because the answer
   * is a question this file already answers for every march: WHERE IS A VALID
   * PLACE TO PUT A BODY. `_sitePoint` tests terrain bounds, slope and the level's
   * own `spawnClear`, in twenty tries, with the ring as the give-up case.
   *
   * At MARCH radius rather than the drop ring, deliberately: that is beyond the
   * distance anything is spawned at, so the body walks back into the fight from
   * the edge exactly as a marching arrival does, and the recovery is a thing you
   * watch rather than a thing that happens. The delivery goes in `this.log`, so
   * `deliveryIsAnnounced` holds it to the same invariant as every other body
   * this director has ever put down.
   *
   * The BODY IS KEPT, not replaced — see the note at the call site. Its velocity
   * is zeroed and the two navigation counters are cleared, because a body that
   * has spent fourteen seconds pressed into a wall is carrying a committed
   * strafe direction and a saturated `_stuckT` that would send it straight back.
   *
   * @returns whether a valid site was found and the body moved to it.
   */
  relocate(e) {
    if (!e || !e.position) return false;
    const ring = this._ring();
    const [mNear, mFar] = marchBand(ring, this._setback());
    const at = this._sitePoint(mNear, mFar, new THREE.Vector3());
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return false;
    /* AND THE GIVE-UP CASE HAS TO BE CHECKED, which is the whole reason this
     * returns a boolean at all. `_sitePoint` falls back to the ring itself when
     * twenty tries all miss — a last resort that is right for a MARCH, where
     * the worst case is an awkward walk. It is not right here: on a world whose
     * bounds are tighter than `ring × MARCH_RADIUS` that fallback point is
     * outside the heightfield, so a rescue would move a body from one
     * impossible place to another and the caller would believe it had worked.
     * Measured end to end in tools/checks/command.mjs, where the wave then
     * never cleared. */
    const t = this.world.terrain;
    if (t?.inBounds && !t.inBounds(at.x, at.z, 0)) return false;
    e.position.set(at.x, at.y, at.z);
    e.velocity?.set?.(0, 0, 0);
    // The two counters `Enemy._move`'s navigation runs on. Left as they were,
    // the body arrives at its new site already convinced it is stuck.
    if (e._wallN?.set) e._wallN.set(0, 0, 0);
    e._wallT = 0;
    e._stuckT = 0;
    e._prevPos?.copy?.(e.position);
    // Re-home the physics capsule too, or the body is drawn at the new site and
    // collides at the old one — which is the same bug with a longer symptom.
    e._syncBody?.();
    const anchor = this._anchor(_v2);
    this.log.push({
      kind: 'march', flight: 'rescue', lead: ARRIVAL_LEAD,
      dist: Math.hypot(at.x - anchor.x, at.z - anchor.z), type: e.type, rescue: true,
    });
    if (this.log.length > 200) this.log.shift();
    return true;
  }

  /** Drop everything — a wave reset, a level change, a run ending. */
  clear() {
    for (const f of this.flights) f.remove();
    this.flights.length = 0;
    this.staging.length = 0;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}

/**
 * Does one delivery satisfy the invariant at the top of this file?
 *
 * Exported because it is the property, and a property that only exists inside
 * a test is a property the game does not have. Anything that adds a new
 * arrival kind is answerable to this function.
 */
export function deliveryIsAnnounced(entry, ring = 56) {
  /* OFF `marchBand`, NOT off `ring × MARCH_RADIUS`. This used to recompute the
   * band's floor itself, which was the same expression until the clamp existed
   * and then was not: on geonosis the placement is now capped at 134.7 m and
   * this would still have been demanding 125.3 m of a band whose floor the cap
   * had pulled to 118.2 — a wave whose bodies were placed correctly and judged
   * against a bar the placement rule no longer aims at. One band, one reader. */
  return entry.lead >= ARRIVAL_LEAD || entry.dist >= marchBand(ring)[0] * 0.9;
}
