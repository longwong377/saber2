/**
 * BATTLEFRONT BORZ — THE ORDER YOU CAN CHECK.
 *
 * PLAN.md §1, "the thesis, as one keypress":
 *
 *   *Save your men or lead them to their deaths* is the brief's own sentence,
 *   and **the order you can check** is it as a mechanic. High Command
 *   designates an artillery ellipse. Force sense shows what is inside it,
 *   including friendly IFF. Obeying is faster and rewarded; verifying costs
 *   twelve seconds under fire. Sometimes your own men are in it and the game
 *   never says so.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ONE THING THAT MAKES IT A DECISION RATHER THAN A PROMPT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * NOBODY LIES TO YOU AND NOBODY IS RIGGED. The order is cut off a SNAPSHOT —
 * the hostiles standing on that ground at the moment High Command wrote the
 * grid reference — and it is never revised. Everything after that is the
 * battle moving: their line falls back, yours advances into the same hollow,
 * and by the time the shells could be released the ellipse holds a different
 * set of bodies than the one it was drawn around.
 *
 * So the game does not have to cheat to put your men under your own guns, and
 * it does not have to warn you either. **The estimate is honest, it is stale,
 * and staleness is the whole mechanic.** A designer's coin-flip ("this one is
 * a trap") would be a rigged prompt with a 20% failure rate; this is a
 * simulation you can read if you go and look.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AND IT IS WELDED TO THE KEYSTONE BY THE ACT OF CHECKING
 * ══════════════════════════════════════════════════════════════════════════
 *
 * PLAN.md's test of every system is: **delete `lineIsUp` — does this section
 * change?** Here the weld is not a clause bolted on afterwards, it is the
 * geometry:
 *
 *   THE READING NEEDS EYES ON THE GROUND. It runs only while you are inside
 *   `SPOTTER_SIGHT` of the mark — the same 70 m `Stratagems` already gates
 *   off-map power on, one owner for one quantity — and the mark is 70–140 m
 *   beyond your own line, on ground the other army is standing on.
 *
 * From there the shipped rules do the rest, and they leave the player exactly
 * three ways to answer, each with a different bill. Measured, three arms, same
 * order and same ten men, in `tools/checks/fire-mission.mjs`:
 *
 *   WALK OUT WITH THEM   the formation anchor moves at `advancePace` — your
 *     line's own pace — so keeping inside `MORALE.NEAR` of your men brings all
 *     ten of them into the ellipse you went out to read. **10 of 10 caught.**
 *     The quorum holds the whole time; what you lose is the men.
 *   RUN OUT ALONE        outrun them and the anchor stops dead (FLAGSHIP §6:
 *     "you can sprint 200 m into their rear; the line does not come with
 *     you"). **0 caught — and the quorum is DOWN for the whole reading**, so
 *     the run does not advance for the twelve seconds you spend checking.
 *   PLANT THEM FIRST     `order(id, cmdr, squad)` gives each squad its own
 *     ground, and `lineGathered` counts a planted man as near where he was
 *     TOLD to be. **0 caught, quorum up.** Both bills paid, with one verb that
 *     shipped for §4.4 and no new interface at all.
 *
 * That is the whole shape of the Umbara arc out of three systems that were
 * already here, and the correct play — plant the line, then go and look — is a
 * thing a player can find and be right about rather than a trap.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT IT COSTS AND WHAT IT PAYS
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   OBEYING is one keypress and it is the fast answer. The prize decays across
 *   the window (`PRIZE` → `PRIZE_FLOOR` of it), so the twelve seconds a
 *   reading takes are paid for in war support whether or not the reading finds
 *   anything. Support you did not spend is a call you cannot make.
 *   VERIFYING is `READ_SECONDS` of standing inside `SPOTTER_SIGHT` of the mark
 *   — or `READ_SECONDS / SENSE_RATE` with Force sense open, which is what
 *   makes Sense the answer and not a decoration. Both are spent under fire,
 *   forward of your own line.
 *   REFUSING is doing nothing until the window closes. It costs the prize and
 *   it costs `TRUST_LOSS` of High Command's patience, which scales the next
 *   order's prize. A general who never answers his comm is a general the fleet
 *   stops backing.
 *
 * And the shells are HIGH COMMAND'S, which decides two things that would
 * otherwise be arbitrary:
 *
 *   THEY ARE NOT SCALED BY `teamDamage`. `installTeamDamage` scales a blow
 *   whose source is on the target's own side; these carry `HIGH_COMMAND`,
 *   which is on nobody's side, so they pay full — the same rule a falling
 *   crate pays under. A fire mission your own line is standing in must not be
 *   survivable because a slider says friendly fire is 35%.
 *   THE REPORT STILL NAMES YOU. `killerName` reads `type` off the source, so
 *   every man killed by it goes into the after-action report as "by your own
 *   fire mission" (PLAN.md §4.9: "no death is mysterious, so no death is the
 *   AI's fault"). You cleared it. It is yours.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, makeRng } from '../engine/MathUtil.js';
import { SPOTTER_SIGHT } from './Stratagems.js';

/* ── the numbers ──────────────────────────────────────────────────────── */

/**
 * HOW LONG AN ORDER STANDS, in seconds.
 *
 * It has to hold a whole decision: hear it, look at where it is, decide
 * whether the ground is worth crossing, cross it, read it, come back. A
 * reading is `READ_SECONDS` and the ground is up to `DEPTH_FAR` metres out at
 * a sprint of 7.45 m/s, so a player who commits immediately spends about 30 s
 * of this on the round trip and has the rest to change his mind in. Shorter
 * and the only playable answer is to obey blind, which is a prompt and not a
 * decision.
 */
export const WINDOW = 45;

/**
 * WHAT IT COSTS TO CHECK — PLAN.md's own twelve seconds, on foot.
 *
 * Twelve is the number in the design and it is kept rather than re-derived,
 * because the whole sentence is "verifying costs twelve seconds under fire"
 * and the cost is meant to be felt as a decision to stand still in the open.
 */
export const READ_SECONDS = 12;

/**
 * …AND HOW MUCH FASTER THE FORCE READS IT.
 *
 * Three, so a reading with Force sense open is four seconds. That number is
 * not decorative: `Player.toggleSense` runs the pool down at `SENSE_DRAIN` and
 * shuts itself off after about 5.7 s from a full bar, so a rate that needed
 * more than one window would make the Force the wrong tool for the one job the
 * design gives it. At 3× the reading fits inside a single hold with room, and
 * the price is the bar you are not going to have for the fight you are
 * standing in.
 */
export const SENSE_RATE = 3;

/**
 * HOW CLOSE YOU HAVE TO BE FOR THE READING TO RUN AT ALL.
 *
 * `SPOTTER_SIGHT`, imported rather than typed: it is already the answer to
 * "how far can somebody on this field see" and it is already what gates
 * off-map power on vision (PLAN.md §4.2's last clause). Two numbers for one
 * question is HANDOFF §2.3's signature defect, and this is the same question.
 */
export const READ_REACH = SPOTTER_SIGHT;

/**
 * THE ELLIPSE, in metres: half-length along the gun-target line, half-width
 * across it.
 *
 * An ellipse and not a circle because a battery's error IS an ellipse — long
 * along its own line of fire and narrow across it, which is the same fact
 * `Stratagems`' barrage walks its twelve shells on. It is also what makes the
 * shape readable on the ground: the long axis points back at whoever is
 * shooting, so a player can tell at a glance which way to step off it.
 */
export const ELLIPSE_A = 34, ELLIPSE_B = 20;

/**
 * HOW MANY SHELLS, AND HOW BIG EACH ONE IS.
 *
 * Eighteen at 6.5 m is 2 390 m² of lethal ground against the ellipse's
 * π·34·20 = 2 136 m². The point of that arithmetic is that the beaten zone is
 * SWEPT and not sampled: a man standing anywhere inside the mark when it comes
 * down is hit, so "were my men in it" is a question with one answer and not a
 * dice roll. The per-shell numbers are the barrage's own (6.5 m, 70 force,
 * 120 damage) because it is the same kind of gun; what makes this a divisional
 * shoot rather than a fire mission you called is that there are half again as
 * many of them and they cover a shape instead of a line.
 */
export const SHELLS = 18;
export const SHELL_R = 6.5, SHELL_FORCE = 70, SHELL_DAMAGE = 120;

/** How long the whole stonk takes to walk across the ellipse, in seconds. */
export const SHELL_SPREAD = 3.1;

/**
 * WHAT ANSWERING PAYS, in war support, and what it decays to.
 *
 * 30 is a shade over a held Battery's 26 a clock (`Objectives._pay`), which is
 * the comparison that matters: answering High Command is worth about what
 * holding an installation is worth, so a player choosing between crossing
 * ground to check a mark and going back to take a site is choosing between two
 * things of the same size. The floor is 0.35 of it — enough that a late yes is
 * still worth saying, little enough that the twelve seconds are real.
 */
export const PRIZE = 30, PRIZE_FLOOR = 0.35;

/**
 * HIGH COMMAND'S PATIENCE, and it is the only state this system carries
 * between orders.
 *
 * Starts at 1, falls `TRUST_LOSS` when a window closes unanswered and recovers
 * `TRUST_GAIN` when one is answered, floored at `TRUST_MIN`. It scales the
 * prize and nothing else — one reader, so it cannot become a hidden second
 * difficulty. Two refusals in a row and the next order is worth about half
 * what the first was, which is the fleet's answer to a general who does not
 * answer his comm, and it recovers in three.
 */
export const TRUST_LOSS = 0.25, TRUST_GAIN = 0.15, TRUST_MIN = 0.35;

/**
 * HOW OFTEN AN ORDER COMES DOWN — first one, then the gap, then the jitter.
 *
 * The opening 70 s is deliberately not zero: the first minute of a battle is
 * the deploy, the walk and the first contact, and an artillery decision on top
 * of that is a decision nobody makes. After that one every 95 s ± 25, so a
 * ten-minute sitting carries five or six of them — enough that the mechanic is
 * a rhythm rather than an event, few enough that it never becomes the thing
 * you are doing instead of fighting.
 */
export const FIRST_AT = 70, CADENCE = 95, CADENCE_JITTER = 25;

/**
 * HOW FAR OUT THE MARK IS LAID, in metres from your commander.
 *
 * Never on your own line — a fire mission on the ground you are standing on is
 * not an order, it is a suicide note — and never past where a runner could
 * reach it inside the window. 70 is just past `MORALE.NEAR`'s five-fold, and
 * it is also `READ_REACH`, which means the NEAREST possible mark can be read
 * from your own line without moving: the closest orders are free to check and
 * the deep ones are not, which is a gradient rather than a rule and gives the
 * player something to learn.
 */
export const DEPTH_NEAR = 70, DEPTH_FAR = 140;

/**
 * WHO THE SHELLS BELONG TO.
 *
 * On nobody's side, so `installTeamDamage` does not scale them (a source with
 * no `team` "is nobody's and pays full" — see that wrapper's own note), and
 * carrying the words the report will print, so `killerName` names it without
 * this file having to reach into Command.js. Frozen and shared: it holds no
 * body, exactly as the `fell` log holds a name and not an Enemy.
 */
export const HIGH_COMMAND = Object.freeze({ type: 'your own fire mission' });
/**
 * …AND THEIRS, WHICH WAS WEARING YOUR NAME.
 *
 * `theirBarrage` is the enemy battery — `Objectives._pay` calls it when a
 * battery the other side holds comes round on its clock — and it went through
 * the same `_release` and the same `_impact`, so every man their shells killed
 * was logged `killer: 'your own fire mission'`. The after-action report then
 * counted those deaths against YOUR OWN SIDE and told the player to stop
 * calling artillery he had never called, which is the exact opposite of what
 * §4.9 exists to do: "no death is mysterious, so no death is the AI's fault"
 * cuts both ways, and blaming the player for the enemy's guns is the same
 * defect wearing the other face.
 *
 * A separate frozen source and not a flag on the shell's blast options: the
 * only thing `killerName` can read is `type`, and the report has to be able to
 * say the words. Still nobody's SIDE, so `installTeamDamage` cannot blunt it on
 * whoever is standing under it — that half was always right.
 */
export const THEIR_BATTERY = Object.freeze({ type: 'their battery' });

/** The three states an order is ever in. */
export const STANDING = 'standing', FIRED = 'fired', LAPSED = 'lapsed';

const _v1 = new THREE.Vector3();

/* ── the mark, drawn ──────────────────────────────────────────────────── */

/**
 * THE ELLIPSE ON THE GROUND, and it is the only per-frame write this file
 * makes to the scene.
 *
 * A ring, scaled to the two half-axes and turned to the gun-target line — the
 * same trick `Objectives` draws a site radius with, for the same reason: "am I
 * on it" must never be a guess. The COLOUR is the whole readout a player gets
 * without a panel:
 *
 *   amber   standing, unverified. High Command's estimate and nothing more.
 *   blue    read, and there is nobody of yours inside it.
 *   red     read, and there is. This is the only place in the game that says
 *           so, and it exists only because you went and looked.
 */
const MARK_COLOUR = { standing: 0xffb648, clear: 0x7fd8ff, friendlies: 0xff5c5c, fired: 0x6d6a63 };

function buildMark(a, b, bearing) {
  const g = new THREE.Group();
  g.name = 'firemission:mark';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.955, 1, 64),
    new THREE.MeshBasicMaterial({ color: MARK_COLOUR.standing, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.scale.set(a, b, 1);
  ring.position.y = 0.07;
  ring.renderOrder = 2;
  g.add(ring);
  /* THE LONG AXIS, DRAWN AS A BAR ACROSS THE MIDDLE. The ellipse alone reads
   * as a circle in perspective from anywhere but overhead, and which way it
   * points is the one thing that tells a player which way to step off it. */
  const spine = new THREE.Mesh(
    new THREE.PlaneGeometry(a * 2, 0.6),
    new THREE.MeshBasicMaterial({ color: MARK_COLOUR.standing, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false }));
  spine.rotation.x = -Math.PI / 2;
  spine.position.y = 0.06;
  spine.renderOrder = 2;
  g.add(spine);
  g.rotation.y = -bearing;
  g.userData.ring = ring;
  g.userData.spine = spine;
  return g;
}

/* ── one order ────────────────────────────────────────────────────────── */

export class FireMission {
  /**
   * @param {THREE.Vector3} centre  the aim point
   * @param {number} bearing        radians, the gun-target line the ellipse is long on
   * @param {object} opts           `{ a, b, grid, told }`
   */
  constructor(centre, bearing, opts = {}) {
    this.centre = centre.clone ? centre.clone() : new THREE.Vector3(centre.x, centre.y, centre.z);
    this.bearing = bearing;
    this.a = opts.a ?? ELLIPSE_A;
    this.b = opts.b ?? ELLIPSE_B;
    /** What High Command calls this piece of ground. Stable, derived from it. */
    this.grid = opts.grid || gridName(this.centre);
    /**
     * WHAT THEY TOLD YOU, AND IT IS NEVER UPDATED.
     *
     * The hostile count on this ground at the moment the order was cut. See
     * the header: the estimate is honest and stale, and the staleness is the
     * mechanic.
     */
    this.told = opts.told | 0;
    this.state = STANDING;
    /** Seconds the order has stood. */
    this.t = 0;
    /** The reading, 0…1. See `READ_SECONDS`. */
    this.read = 0;
    /** Live counts, published only once `verified`. */
    this.hostiles = 0;
    this.friendlies = 0;
    /** Named men of yours inside it, at most three plus a count. */
    this.names = [];
    /** What was standing in it when the shells were released. */
    this.caught = null;
    this.group = null;
  }

  get verified() { return this.read >= 1; }
  /** Seconds left before the window closes. */
  get left() { return Math.max(0, WINDOW - this.t); }

  /**
   * IS THIS POINT INSIDE THE ELLIPSE? The one geometry question this file
   * asks, and everything else — the reading, the shelling, the report — asks
   * it through this, so the mark drawn on the ground and the ground that gets
   * shelled cannot disagree.
   */
  inside(p) {
    if (!p) return false;
    const dx = p.x - this.centre.x, dz = p.z - this.centre.z;
    const c = Math.cos(this.bearing), s = Math.sin(this.bearing);
    /* Into the ellipse's own frame: `u` along the gun-target line, `v` across. */
    const u = dx * s + dz * c;
    const v = dx * c - dz * s;
    return (u * u) / (this.a * this.a) + (v * v) / (this.b * this.b) <= 1;
  }

  /**
   * WHAT A PANEL OR A CHECK MAY KNOW.
   *
   * `hostiles`, `friendlies` and `names` are null until the reading is
   * finished, and that is not a display convention — it is the feature. "The
   * game never says so" is a property of this object, so a HUD that forgot to
   * hide them could not leak what the player has not earned.
   */
  readout() {
    return {
      grid: this.grid, state: this.state, told: this.told,
      left: this.left, read: this.read, verified: this.verified,
      hostiles: this.verified ? this.hostiles : null,
      friendlies: this.verified ? this.friendlies : null,
      names: this.verified ? this.names.slice() : null,
    };
  }
}

/**
 * WHAT HIGH COMMAND CALLS A PIECE OF GROUND.
 *
 * Quantised to 50 m and lettered, so the same hollow has the same name every
 * time anybody refers to it and two marks 30 m apart are not two grids. It is
 * flavour that has to be stable: a player who hears "grid four-two" twice in a
 * sitting has learned a place.
 */
export function gridName(p) {
  const L = 'ABCDEFGHJKLMNPQRSTUV';           // no I or O — they read as 1 and 0
  const gx = Math.floor(p.x / 50), gz = Math.floor(p.z / 50);
  return `${L[((gx % L.length) + L.length) % L.length]}${((gz % 90) + 90) % 90 + 10}`;
}

/* ── the director ─────────────────────────────────────────────────────── */

export class FireMissionDirector {
  /**
   * @param {object} world  read for `scene`, `terrain`, `enemies`, `player`,
   *                        `command`, `support`, `notify` and `time` — every
   *                        one optional, because this has to be constructible
   *                        in a check fixture that has none of them.
   */
  constructor(world, opts = {}) {
    this.world = world;
    /** Whose side the orders come to. */
    this.myTeam = opts.myTeam ?? 0;
    /** The order standing right now, or null. */
    this.mission = null;
    /** High Command's patience. See TRUST_LOSS. */
    this.trust = 1;
    /** Seconds until the next order is cut. */
    this.next = opts.first ?? FIRST_AT;
    this.rng = opts.rng || makeRng(opts.seed ?? 0x1e11e);
    /* Counters, so a check can price this rather than time it (HANDOFF §2.6). */
    this.issued = 0;
    this.fired = 0;
    this.lapsed = 0;
    this.verifiedCount = 0;
    /** Shells still in the air, `{ t, at }`. Stepped by `update`. */
    this._shells = [];
  }

  /* ── the clock ──────────────────────────────────────────────────────── */

  update(dt, ctx = {}) {
    if (!(dt > 0)) return;
    this._stepShells(dt, ctx);
    this._sweep();
    const m = this.mission;
    if (!m) {
      this.next -= dt;
      if (this.next <= 0) this.issue();
      return;
    }
    m.t += dt;
    this._readTick(dt, m);
    this._paint(m);
    if (m.t >= WINDOW) this._lapse(m);
  }

  /**
   * THE READING. It runs only while somebody with eyes is inside `READ_REACH`
   * of the mark, and Force sense runs it `SENSE_RATE` times as fast.
   *
   * THE PLAYER'S EYES AND NOT A TROOPER'S, deliberately, and this is the one
   * place this system disagrees with §4.2's spotter gate. A spotter can tell
   * you there is something on that ground; he cannot tell you WHOSE, because
   * the whole reason the order is checkable is that the Force reads life and
   * not silhouettes. Handing the reading to any trooper who happens to be
   * forward would make the decision "did I leave a man out there" rather than
   * "will I go and look", which is a different and much smaller game.
   */
  _readTick(dt, m) {
    const p = this.world?.player;
    if (!p || p.dead) return;
    const d = Math.hypot(p.position.x - m.centre.x, p.position.z - m.centre.z);
    if (d > READ_REACH) return;
    const was = m.verified;
    m.read = clamp(m.read + dt * (p.senseActive ? SENSE_RATE : 1) / READ_SECONDS, 0, 1);
    if (m.verified) {
      this._count(m);
      if (!was) {
        this.verifiedCount++;
        this.world?.notify?.(`GRID ${m.grid} — READ`, m.friendlies
          ? `${m.friendlies} of yours inside the mark`
          : `${m.hostiles} hostile${m.hostiles === 1 ? '' : 's'}, none of yours`);
      }
    }
  }

  /**
   * WHO IS STANDING IN IT RIGHT NOW. Live, once the reading is in — a truth
   * you have to keep looking at, because the ground goes on changing and a
   * frozen answer would make the reading a coupon rather than an observation.
   */
  _count(m) {
    let hostiles = 0, friendlies = 0;
    const names = [];
    for (const e of (this.world?.enemies || [])) {
      if (!e || e.dead || e.team == null) continue;
      if (!m.inside(e.position)) continue;
      if (e.team === this.myTeam) {
        friendlies++;
        if (e.trooper?.name && names.length < 3) names.push(e.trooper.name);
      } else hostiles++;
    }
    m.hostiles = hostiles; m.friendlies = friendlies; m.names = names;
    return m;
  }

  /* ── cutting an order ───────────────────────────────────────────────── */

  /**
   * WHERE THE MARK GOES: the densest knot of them between `DEPTH_NEAR` and
   * `DEPTH_FAR` of your commander.
   *
   * Densest and not nearest, because an order is worth answering only if there
   * is something on the ground worth a battery's time — and because the knot
   * of bodies is exactly the ground your own line is walking toward, which is
   * what makes the estimate go stale in the direction that matters.
   *
   * A field with nothing on that ground gets NO ORDER. High Command does not
   * invent targets, and a mark on empty grass would teach the player that
   * answering is free.
   */
  _pick() {
    const w = this.world;
    const from = w?.command?.commander?.player?.position || w?.player?.position;
    if (!from) return null;
    const hostiles = [];
    for (const e of (w?.enemies || [])) {
      if (!e || e.dead || e.team == null || e.team === this.myTeam) continue;
      const d = Math.hypot(e.position.x - from.x, e.position.z - from.z);
      if (d < DEPTH_NEAR || d > DEPTH_FAR) continue;
      hostiles.push(e);
    }
    if (!hostiles.length) return null;
    /* The knot: whichever of them has the most company inside one ellipse's
     * half-width. O(n²) over a list that is at most a few dozen bodies in one
     * annulus, once every ninety seconds — see HANDOFF §2.6 on pricing. */
    let best = null, bestN = -1;
    for (const e of hostiles) {
      let n = 0;
      for (const o of hostiles) {
        if (Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z) <= ELLIPSE_B) n++;
      }
      if (n > bestN) { bestN = n; best = e; }
    }
    if (!best) return null;
    const centre = _v1.copy(best.position);
    centre.y = w?.terrain?.height ? w.terrain.height(centre.x, centre.z) : 0;
    return { centre: centre.clone(), bearing: Math.atan2(centre.x - from.x, centre.z - from.z) };
  }

  /** Cut an order, or decline to. Returns the mission or null. */
  issue(at = null) {
    if (this.mission) return null;
    const spot = at || this._pick();
    this.next = CADENCE + (this.rng() - 0.5) * 2 * CADENCE_JITTER;
    if (!spot) return null;
    const m = new FireMission(spot.centre, spot.bearing, { a: spot.a, b: spot.b });
    /* THE ESTIMATE, TAKEN ONCE. `_count` writes the live truth onto the
     * mission; the number that goes on the card is a copy of the hostile half
     * of it, taken now and never touched again. */
    this._count(m);
    m.told = m.hostiles;
    m.hostiles = 0; m.friendlies = 0; m.names = [];
    m.read = 0;
    this.mission = m;
    this.issued++;
    this._draw(m);
    this.world?.notify?.(`FIRE MISSION — GRID ${m.grid}`,
      `${m.told} hostile${m.told === 1 ? '' : 's'} estimated. Cleared to fire on your word.`);
    return m;
  }

  /* ── answering ──────────────────────────────────────────────────────── */

  /**
   * YES. The one keypress.
   *
   * Everything the design turns on happens in this method and it is deliberately
   * short: the shells are released, the ground is recorded as it was at the
   * moment of release, and the prize is paid at whatever the clock has left it
   * worth. There is no confirmation, no "are your men clear?", and no second
   * press. Obeying is FAST, which is the half of the sentence that makes the
   * other half cost something.
   */
  authorise() {
    const m = this.mission;
    if (!m || m.state !== STANDING) return false;
    /* THE GROUND AS IT IS AT THE MOMENT YOU SAY YES — not as it was read, and
     * not as it will be when the last shell lands. This is the record the
     * report is written from and the answer to "was I right". */
    this._count(m);
    m.caught = { hostiles: m.hostiles, friendlies: m.friendlies, names: m.names.slice(),
                 verified: m.verified };
    m.state = FIRED;
    this.fired++;
    this._release(m);
    const pay = this._prize(m);
    this.world?.support?.credit?.(pay);
    this.trust = clamp(this.trust + TRUST_GAIN, TRUST_MIN, 1);
    this._log(m, false);
    this.world?.notify?.(`GRID ${m.grid} — CLEARED`, m.caught.friendlies
      ? `${m.caught.friendlies} of yours were standing in it`
      : `+${Math.round(pay)} war support`);
    this._paint(m);
    return true;
  }

  /**
   * WHAT ANSWERING IS WORTH RIGHT NOW: the prize, decayed across the window
   * and scaled by patience.
   *
   * Linear rather than a cliff, because a cliff would make the reading a
   * yes/no gate on a stopwatch — cross it and the twelve seconds cost you
   * everything — and the design wants the twelve seconds to cost SOMETHING at
   * every moment of the window, which is what makes late information still
   * worth having.
   */
  _prize(m) {
    const k = PRIZE_FLOOR + (1 - PRIZE_FLOOR) * (1 - clamp(m.t / WINDOW, 0, 1));
    return PRIZE * k * this.trust;
  }

  /** The window closed with nobody answering. */
  _lapse(m) {
    if (m.state !== STANDING) return;
    m.state = LAPSED;
    this.lapsed++;
    this.trust = clamp(this.trust - TRUST_LOSS, TRUST_MIN, 1);
    this._log(m, true);
    this.world?.notify?.(`GRID ${m.grid} — WAVED OFF`,
      'the guns are laid on somebody else now');
    this._clear();
  }

  /**
   * THE SHELLS.
   *
   * Sampled uniformly over the ellipse — `sqrt` on the radius, or every shell
   * crowds the middle and the edge of the mark is a safe place to stand, which
   * would make the drawn shape a lie — and walked over `SHELL_SPREAD` seconds
   * so a man can be caught running out of it and a player can watch what he
   * did arrive.
   *
   * THROUGH `Stratagems.blast`, WHICH IS THE ONE DOOR ORDNANCE COMES THROUGH.
   * A private copy of the falloff, the crater, the Force answer and the
   * knockback is the twin defect this codebase has paid for eight times
   * (HANDOFF §2.3). What this file owns is the pattern; what the blast does
   * when it lands belongs to the system that already owns it.
   */
  _release(m) {
    const rng = this.rng;
    for (let i = 0; i < SHELLS; i++) {
      const r = Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      const u = Math.cos(a) * r * m.a, v = Math.sin(a) * r * m.b;
      const c = Math.cos(m.bearing), s = Math.sin(m.bearing);
      const at = new THREE.Vector3(
        m.centre.x + u * s + v * c, m.centre.y, m.centre.z + u * c - v * s);
      /* WHOSE GUNS, carried on the shell rather than read at impact: three
       * seconds pass between release and landing and `this.mission` is long
       * since cleared by then, so the shell is the only thing that still knows.
       * See THEIR_BATTERY. */
      this._shells.push({ t: (i / SHELLS) * SHELL_SPREAD, at, src: m.theirs ? THEIR_BATTERY : HIGH_COMMAND });
    }
  }

  _stepShells(dt, ctx) {
    if (!this._shells.length) return;
    const live = [];
    for (const sh of this._shells) {
      sh.t -= dt;
      if (sh.t > 0) { live.push(sh); continue; }
      /* RESOLVED AGAINST THE FRAME IT LANDS IN, not the one it was released
       * in. A shell is three seconds in the air and the field moves under it;
       * `World._frameCtx` is rebuilt every frame and carries the enemies, the
       * terrain and the physics as they are NOW, which is the only honest
       * thing for a blast to ask. */
      this._impact(sh.at, ctx, sh.src);
    }
    this._shells = live;
  }

  _impact(at, ctx, src) {
    const S = this.world?.player?.stratagems;
    if (!S?.blast) return;
    S.blast(ctx || {}, at, SHELL_R, SHELL_FORCE, SHELL_DAMAGE, {
      core: 0.25, shake: 0.30, size: 1.7, crater: 0.9,
      sparkShare: 1 / Math.sqrt(SHELLS),
      /* NOBODY'S, so it pays full through `installTeamDamage`, and named, so
       * the report can say what it was — and named ACCURATELY, which is the
       * half that was wrong. See HIGH_COMMAND and THEIR_BATTERY. */
      source: src || HIGH_COMMAND,
    });
  }

  /**
   * SHELLS THAT ARE NOT YOURS — the Battery's own "lost" row, which promised
   * "It fires for them" and reached a door nobody had installed.
   *
   * `Objectives._pay` calls `world.onObjectiveFire` when a battery the other
   * side holds comes round on its clock, and `World` wires that here because
   * this file is where a fire mission already knows how to be laid.
   *
   * ══════════════════════════════════════════════════════════════════════
   *  AND A BATTERY DOES NOT FIRE ON ITS OWN LINE
   * ══════════════════════════════════════════════════════════════════════
   *
   * The first version aimed at your line's centroid, full stop, and that is
   * where your line is IN CONTACT — so their own guns walked eighteen shells
   * through their own assault every twenty-six seconds and cleared the waves
   * for you. Measured on the flagship's own timing drive (theline.19, seed 11,
   * both armies held unkillable on the player's side): a Raid that floors at
   * 10.0–11.6 minutes floored at **4.9**, which is the mode's whole length
   * halved by a feature meant to threaten the player.
   *
   * So the aim point is the densest knot of your men with NO hostile inside
   * the pattern's own reach, and if there is no such knot the guns stay
   * silent. That is not a special case bolted on to fix a number — it is what
   * a battery does, and it turns into a rule the player can use: **stay in
   * contact and their artillery cannot touch you.** The men it can reach are
   * your reserve, your crews and the squad you planted on a gun two hundred
   * metres from the fighting, which is exactly the half of your army the rest
   * of this mode rewards you for putting somewhere.
   */
  theirBarrage() {
    const spot = this._clearOfTheirOwn();
    if (!spot) return false;
    const from = this.world?.player?.position || spot;
    const m = new FireMission(spot, Math.atan2(spot.x - from.x, spot.z - from.z));
    /* THEIRS. Read by `_release` and carried to the report on every shell — see
     * THEIR_BATTERY, which is the whole reason this line exists. */
    m.theirs = true;
    this._release(m);
    this.world?.notify?.('INCOMING', 'their battery is firing on your rear');
    return true;
  }

  /**
   * THE KNOT OF YOUR MEN THEIR GUNS CAN ACTUALLY SHOOT AT, or null.
   *
   * Densest first, and a candidate is disqualified by a single hostile inside
   * `ELLIPSE_A` of it — the longest half-axis the pattern has, so the guard is
   * the pattern's own worst case rather than a second number. A circle and not
   * the ellipse itself because the ellipse is not oriented until a candidate is
   * chosen, and a battery that has to think about it does not fire.
   */
  _clearOfTheirOwn() {
    const mine = this._line();
    if (!mine.length) return null;
    const theirs = [];
    for (const e of (this.world?.enemies || [])) {
      if (!e || e.dead || e.team == null || e.team === this.myTeam) continue;
      theirs.push(e);
    }
    let best = null, bestN = -1;
    for (const a of mine) {
      let clear = true;
      for (const h of theirs) {
        if (Math.hypot(h.position.x - a.position.x, h.position.z - a.position.z) <= ELLIPSE_A) {
          clear = false; break;
        }
      }
      if (!clear) continue;
      let n = 0;
      for (const b of mine) {
        if (Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) <= ELLIPSE_B) n++;
      }
      if (n > bestN) { bestN = n; best = a; }
    }
    if (!best) return null;
    const centre = new THREE.Vector3(best.position.x, 0, best.position.z);
    centre.y = this.world?.terrain?.height ? this.world.terrain.height(centre.x, centre.z) : 0;
    return centre;
  }

  /** Every living body of your side — which in this mode is the line. */
  _line() {
    const out = [];
    for (const e of (this.world?.enemies || [])) {
      if (!e || e.dead || e.team !== this.myTeam) continue;
      out.push(e);
    }
    return out;
  }

  /* ── the record ─────────────────────────────────────────────────────── */

  /**
   * INTO THE COMMANDER'S OWN LOG, which is where the after-action report reads
   * from (`Session.interludeBeats`).
   *
   * A second log would be a second answer to "what happened in this
   * engagement", and the one thing this entry has to do is sit in the same
   * slice as the `fell` entries it caused — so that a player reading the
   * report sees the order and the names under it, in one place, and can join
   * them himself. Nothing here holds a body.
   */
  _log(m, lapsed) {
    const log = this.world?.command?.log;
    if (!Array.isArray(log)) return;
    log.push({
      t: 'mission', grid: m.grid, lapsed: !!lapsed,
      told: m.told,
      verified: !!(m.caught ? m.caught.verified : m.verified),
      hostiles: m.caught ? m.caught.hostiles : null,
      friendlies: m.caught ? m.caught.friendlies : null,
      names: m.caught ? m.caught.names.slice() : [],
      at: Math.round((this.world?.time || 0) * 10) / 10,
    });
  }

  /* ── the mark on the ground ─────────────────────────────────────────── */

  _draw(m) {
    const scene = this.world?.scene;
    if (!scene) return;
    m.group = buildMark(m.a, m.b, m.bearing);
    m.group.position.copy(m.centre);
    scene.add(m.group);
    this._paint(m);
  }

  _paint(m) {
    const g = m.group;
    if (!g) return;
    const key = m.state !== STANDING ? 'fired'
      : !m.verified ? 'standing'
        : m.friendlies > 0 ? 'friendlies' : 'clear';
    /* THE LAST TEN SECONDS PULSE. A window you cannot see closing is a window
     * that closes while you are looking at something else, and the whole cost
     * of refusing is supposed to be a thing you chose. */
    const urgent = m.state === STANDING && m.left < 10
      ? 0.5 + 0.35 * Math.sin(m.t * 7) : 0.5;
    for (const part of [g.userData.ring, g.userData.spine]) {
      if (!part) continue;
      part.material.color.setHex(MARK_COLOUR[key]);
    }
    g.userData.ring.material.opacity = urgent;
    g.userData.spine.material.opacity = urgent * 0.44;
  }

  /** Everything a HUD or a check wants about the standing order, or null. */
  readout() {
    const m = this.mission;
    if (!m) return null;
    return { ...m.readout(), trust: this.trust, prize: Math.round(this._prize(m)) };
  }

  _clear() {
    const m = this.mission;
    this.mission = null;
    if (!m?.group) return;
    m.group.removeFromParent();
    m.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
    m.group = null;
  }

  /**
   * A FIRED ORDER IS CLEARED ONCE ITS SHELLS ARE DOWN, not on the keypress —
   * the mark has to stay on the ground while the ground is being hit, or the
   * player loses the one drawing that says where it is landing.
   */
  _sweep() {
    const m = this.mission;
    if (m && m.state === FIRED && !this._shells.length) this._clear();
  }

  dispose() {
    this._shells.length = 0;
    this._clear();
  }
}
