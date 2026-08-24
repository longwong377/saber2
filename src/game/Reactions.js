/**
 * BATTLEFIELD BORZ — WHAT A SOLDIER DOES ABOUT SOMETHING ROLLING AT HIS FEET.
 *
 * ── THE NOTE ─────────────────────────────────────────────────────────────
 *
 * "I haven't seen any troops diving or having any dynamic movements, they
 *  should be smart and reactive to their own environment with self
 *  preservation, like diving out of the way of a grenade or picking one up and
 *  throwing it back (sometimes killing themselves) or diving on a grenade to
 *  save their friends if they're brave and selfless enough, or dragging their
 *  friends to safety, not just this stuff you know this stuff and more, you
 *  need to be really creative here the world is our oyster."
 *
 * ── WHY NONE OF IT EXISTED, WHICH IS ONE SENTENCE ────────────────────────
 *
 * There was nothing to react TO. `Stratagems.blast` is an instantaneous event:
 * a call lands, a sphere of damage is applied and the frame moves on. Nothing
 * in this game had ever occupied a piece of ground for a second and a half
 * while everybody nearby decided what to do about it — and every behaviour in
 * the player's note is a decision taken during exactly that second and a half.
 * Writing "dive out of the way" against an instantaneous explosion is writing a
 * reaction to something that is already over.
 *
 * So the first thing here is a LIVE GRENADE: thrown on an arc, landing where it
 * lands, sitting there with a fuse burning, blowing up on its own clock. The
 * behaviours are what bodies do while it sits.
 *
 * ── THE FOUR ANSWERS, AND WHO GIVES WHICH ───────────────────────────────
 *
 * Every one of them is the player's own line, and the choice between them is
 * made out of state this game already keeps rather than out of a die roll:
 * how close the thing is, how long is left on it, how many friends are inside
 * the blast, and — the one that makes it a character rather than a rule — how
 * much NERVE the man has, which Command.js already tracks per soldier and the
 * player can already see on his nameplate.
 *
 *   SHOUT      whoever notices first yells. It costs him a beat and it hands
 *              everybody else theirs: `_heard` cuts their reaction lag, so a
 *              squad answers together instead of one man at a time. This is the
 *              cheapest thing in the file and it is most of why the whole
 *              behaves like a squad.
 *   DIVE       the default, and the answer to "self preservation": leave the
 *              radius, land flat, get up. Anyone will do it.
 *   THROW BACK "picking one up and throwing it back (sometimes killing
 *              themselves)". Needs nerve, needs the fuse to be long enough to
 *              be worth trying — and the man who misjudges it is holding a live
 *              grenade when it goes off, which is not a special case in this
 *              code: the fuse simply keeps burning while he carries it.
 *   SMOTHER    "diving on a grenade to save their friends if they're brave and
 *              selfless enough". The rarest and the most expensive: he goes ON
 *              it, the blast is spent into his body, and the men he was covering
 *              take a fraction of what they would have. It is gated on nerve
 *              AND on there being somebody to save, because a man throwing
 *              himself on a grenade in an empty field is not brave, he is a bug.
 *
 * And one that is not about grenades at all:
 *
 *   DRAG       "dragging their friends to safety". A soldier next to a man who
 *              has gone down takes him by the collar and pulls him out of the
 *              beaten zone, and the two of them move at a walk while he does
 *              it. It is the only behaviour here with no timer on it: he stops
 *              when the ground is safe, when the casualty is up, or when
 *              somebody shoots him.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
 *
 * A second blast rule. `Stratagems.blast` is the one door every explosion in
 * this game goes through — it answers Force pools, bills team damage through
 * Command's own wrapper, craters the terrain and shakes the camera — and a
 * grenade that wrote its own damage loop would be the twin this repository
 * keeps deleting. `GrenadeField` is handed the world's Stratagems and calls it.
 */

import * as THREE from 'three';
import { clamp, damp } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
/**
 * THE LEDGER, AND IT IS THE SAME ONE THE REST OF THE GAME READS.
 *
 * `Nerve.nerveOf` routes: a body with a `Trooper` record answers with the
 * record's morale, a body without one answers with `Enemy.nerve` — the number
 * `nerveTick` drives down while a lit blade stands in the rank and
 * `witnessDeath` knocks every time something falls beside it. `Nerve.js` is a
 * leaf (MathUtil and Morale, nothing else), so this import cannot cycle.
 */
import { nerveOf as ledgerNerve } from './Nerve.js';

/**
 * HOW LONG A GRENADE BURNS, in seconds.
 *
 * Every number in this file is priced against it, so it is the one to argue
 * about. 2.6 is long enough for all four answers to be reachable — a dive
 * needs about 0.6 s, a throw-back about 1.4 including the run — and short
 * enough that standing still is never one of them. Measured against the
 * roster's own speeds: a trooper at 4.1 m/s clears a 7.5 m blast from the
 * middle in 1.8 s, so a man who reacts late genuinely does not get out.
 */
export const FUSE = 2.6;

/**
 * WHAT ONE DOES WHEN IT GOES OFF. Priced beside the roster rather than beside
 * the stratagems: a trooper has 46 hp and a B1 has 24, so 95 in the core is a
 * kill on anything in the line and the taper is what makes the edge of it
 * survivable — which is what makes diving out worth doing rather than academic.
 */
/**
 * WHAT ONE DOES WHEN IT GOES OFF.
 *
 * Priced against the ROSTER rather than against the stratagems: a clone
 * trooper has 46 hp, a B1 has 24. 62 in the core is a kill on anything in
 * either line and the taper is what makes the fringe survivable — which is the
 * whole reason diving out is worth doing rather than academic. At 3 m a
 * trooper takes about 34 and lives; at 5 m about 14.
 *
 * IT WAS 95 IN A 7.5 m RADIUS AND THAT WAS TOO MUCH, measured rather than
 * felt: on Command's own idle-army check — ten troopers, a three-body horde,
 * a driven wave — the roster's kills fell from three to ZERO, because one
 * droid grenade landing in a line of ten wiped enough of it that the survivors
 * never got the wave down. A grenade that removes a squad is not a thing to
 * react to; it is a thing that has already happened.
 */
export const GRENADE = { radius: 6.5, force: 24, damage: 62, core: 0.22, crater: 0.36 };

/** How far away a body notices one at all. Past this it does not know. */
export const NOTICE = 16;

/**
 * HOW LONG BEFORE HE MOVES, in seconds — the whole of "reactive" as a feel.
 *
 * A body that reacts on the frame the grenade lands is a machine and reads as
 * one; a body that takes half a second is a man. `base` is a steady soldier's,
 * `shaken` is what fear adds (a frightened man freezes first), and `heard` is
 * what a shout takes off — which is why a squad with one alert man in it moves
 * as a squad.
 */
export const LAG = { base: 0.34, shaken: 0.42, heard: 0.16, jitter: 0.18 };

/** Nerve a man needs before he will try to throw one back, and to lie on one. */
export const NERVE = { throwBack: 0.42, smother: 0.78 };

/**
 * WHAT SMOTHERING IS WORTH TO THE MEN BEHIND HIM.
 *
 * 0.25 — they take a quarter of what they would have. Not zero, because a body
 * is not a bunker and a grenade that hurt nobody would make the act free; not
 * a half, because at a half the man who did it has spent his life on very
 * little. It is applied by shrinking the blast the OTHERS see, so the arithmetic
 * is the shipped falloff rather than a second damage model.
 */
export const SMOTHER_SHARE = 0.25;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/**
 * A little deterministic noise, seeded per body, so a squad is not a chorus.
 *
 * FROM THE POSITION AND NOT FROM `id`, and that is not a style choice: an
 * `Enemy`'s id is a STRING in this codebase, `'trooper' * 2654435761` is NaN,
 * and the NaN went straight into a throw's aim error and out into `to.z`. A
 * grenade thrown back to `(x, NaN)` is a grenade that is nowhere — measured as
 * "it was thrown back NaN m". Hashing the spawn position gives the same
 * property that was wanted (stable per body, different between neighbours)
 * out of two numbers that are always numbers.
 */
function jitterOf(body) {
  let h = body._jitter;
  if (h === undefined) {
    const x = Math.round((body.position?.x ?? 0) * 131) | 0;
    const z = Math.round((body.position?.z ?? 0) * 977) | 0;
    h = body._jitter = (Math.abs(Math.imul(x ^ z, 2654435761)) % 1000) / 1000;
  }
  return h;
}

/**
 * A LIVE GRENADE — thrown, flying, landed, burning.
 *
 * The flight is a plain ballistic arc solved once at the throw rather than
 * integrated, because what matters about a thrown grenade is WHERE IT LANDS and
 * when: every reaction below is timed against `fuse`, and a bounce that carried
 * it two metres further would silently change who was inside the radius. It
 * still falls under gravity on screen — the arc is real — it simply cannot
 * surprise the simulation with where it ends up.
 */
class LiveGrenade {
  constructor(field, from, to, opts = {}) {
    this.field = field;
    this.owner = opts.owner ?? null;
    /**
     * A CLIENT'S COPY OF SOMEBODY ELSE'S GRENADE, and it is a PICTURE.
     *
     * `NEXT.md` carried this as an open gap: *"GrenadeField is host-side only,
     * so a co-op client sees no grenade, no shout and no crater."* A ghost
     * flies the same arc, makes the same noise, is dived away from by the same
     * men and leaves the same hole — and does no damage at all, because the
     * host has already done it and the result arrives as hp in the next
     * snapshot. A client that applied the blast as well would kill the same
     * droid twice on its own screen and then be corrected, which is what a
     * desync looks like from the sofa. See `World._recordNades`.
     */
    this.ghost = !!opts.ghost;
    /** Whose grenade it is. Reactions only ever come from the other side. */
    this.team = opts.team ?? (this.owner?.team ?? 1);
    this.from = from.clone();
    this.to = to.clone();
    this.fuse = opts.fuse ?? FUSE;
    this.t = 0;
    /** When the CURRENT flight began. See `relaunch`: the fuse's clock and the
     *  arc's clock are two different things after a grenade is thrown back. */
    this.launched = 0;
    this.dead = false;
    /** Set by a smother — see `SMOTHER_SHARE`. */
    this.smotheredBy = null;
    /** Who is carrying it right now, mid-throw-back. */
    this.carrier = null;
    /** How many times it has been thrown back. Purely for the readout. */
    this.returns = 0;
    this.position = from.clone();

    /* THE ARC. `rise` is how far above the straight line the apex sits, as a
     * share of the throw's length, capped so a short lob is not a mortar. */
    const span = Math.max(1e-3, from.distanceTo(to));
    this.flight = clamp(span / 14, 0.35, 1.5);
    this.rise = Math.min(2.6, span * 0.22 + 0.6);
    this.mesh = null;
    if (field.scene) {
      const g = new THREE.SphereGeometry(0.11, 8, 6);
      const m = new THREE.MeshLambertMaterial({ color: 0x3a4038, emissive: 0x000000 });
      this.mesh = new THREE.Mesh(g, m);
      this.mesh.castShadow = false;
      field.scene.add(this.mesh);
    }
    audio.tone({ freq: 520, freqEnd: 300, dur: 0.18, gain: 0.06, type: 'triangle', pos: from });
  }

  /** True once it is on the ground and can be picked up or landed on. */
  get grounded() { return this.t - this.launched >= this.flight && !this.carrier; }
  /** Seconds before it goes off. */
  get left() { return Math.max(0, this.fuse - this.t); }

  update(dt, ctx) {
    this.t += dt;
    if (this.carrier && !this.carrier.dead) {
      /* CARRIED. A man who picked it up holds it at chest height and the fuse
       * does not care that he did — which is the whole of "sometimes killing
       * themselves". */
      this.position.copy(this.carrier.position);
      this.position.y += (this.carrier.A?.hipHeight ?? 0.95) + 0.35;
    } else if (this.carrier) {
      /* He died holding it. It falls where he fell. */
      this.carrier = null;
      this.to.copy(this.position);
      this.from.copy(this.position);
      this.launched = this.t - this.flight;          // on the ground, now
    } else if (this.t - this.launched < this.flight) {
      const k = (this.t - this.launched) / this.flight;
      this.position.lerpVectors(this.from, this.to, k);
      this.position.y += Math.sin(k * Math.PI) * this.rise;
    } else {
      this.position.copy(this.to);
      const g = ctx?.terrain?.height?.(this.to.x, this.to.z);
      if (g !== undefined) this.position.y = Math.max(this.to.y, g + 0.11);
    }
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      /* IT TELLS YOU HOW LONG IS LEFT. A live grenade the player cannot read is
       * an unfair death; the blink rate doubles over the fuse, which is the
       * oldest and clearest signal there is. */
      const urgency = 1 - this.left / Math.max(this.fuse, 1e-3);
      const blink = Math.sin(this.t * (8 + urgency * 26)) > 0 ? 1 : 0;
      this.mesh.material.emissive.setRGB(blink * (0.2 + urgency), 0, 0);
    }
    if (this.t >= this.fuse) this.detonate(ctx);
  }

  /** Throw it from where it is at a new point — the returned grenade. */
  relaunch(from, to) {
    this.carrier = null;
    this.from.copy(from);
    this.to.copy(to);
    this.returns++;
    const span = Math.max(1e-3, from.distanceTo(to));
    this.flight = clamp(span / 14, 0.3, 1.2);
    this.rise = Math.min(2.4, span * 0.2 + 0.5);
    /**
     * `t` IS THE FUSE'S CLOCK AND MUST NOT BE REWOUND — a grenade you throw
     * back is a grenade with less time on it, and that is the risk in doing it.
     * So the FLIGHT gets a clock of its own, stamped here: `update` reads
     * `t - launched` for the arc and `t` for the fuse, and the first version of
     * this wrote the stamp and never read it — which put `k = t / flight` well
     * past 1 on the very first frame after a return, so the grenade teleported
     * to its destination and `wobble` divided by a span of nothing.
     */
    this.launched = this.t;
  }

  detonate(ctx) {
    if (this.dead) return;
    this.dead = true;
    const S = this.field.stratagems;
    const site = this.position.clone();
    if (this.ghost) {
      /* THE PICTURE AND NOTHING ELSE — the sound, the light and the hole, with
       * `cosmetic` telling `Stratagems.blast` to stop before it reaches a
       * single body. See `ghost` in the constructor. */
      S?.blast?.(ctx, site, GRENADE.radius, 0, 0,
        { core: 0, crater: GRENADE.crater, source: null, cosmetic: true });
      this.field.stats.blown++;
      this.dispose();
      return;
    }
    if (this.smotheredBy && !this.smotheredBy.dead) {
      /**
       * A BODY ON TOP OF IT. The man takes it whole and everybody else takes
       * `SMOTHER_SHARE` of what the blast would have given them — expressed as
       * a SMALLER BLAST rather than as a second damage model, so the falloff,
       * the Force answer, the team-damage wrapper and the crater are all still
       * `Stratagems.blast`'s.
       */
      const m = this.smotheredBy;
      m.damage?.(GRENADE.damage * 3, site, this.owner, 'explosion');
      S?.blast?.(ctx, site, GRENADE.radius * 0.6, GRENADE.force * SMOTHER_SHARE,
        GRENADE.damage * SMOTHER_SHARE,
        { core: 0, crater: GRENADE.crater * 0.5, source: this.owner });
      this.field.stats.smothered++;
    } else {
      /* `source` IS THE THROWER. See `Stratagems.blast`: without it every kill
       * a soldier's grenade makes is credited to the player, who did not throw
       * it — and in Command that is a rank and a promotion going to the wrong
       * man's record. */
      S?.blast?.(ctx, site, GRENADE.radius, GRENADE.force, GRENADE.damage,
        { core: GRENADE.core, crater: GRENADE.crater, source: this.owner });
    }
    this.field.stats.blown++;
    this.dispose();
  }

  dispose() {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}

/**
 * EVERY LIVE GRENADE ON THE FIELD, and the only thing that knows about them.
 *
 * Owned by World beside `bolts` and `smoke`, updated in the same place, and
 * asked one question by everybody else: `nearest(position, team)`. That is the
 * whole interface, and it is deliberately not "give me the list" — a caller
 * with the list would write its own idea of what counts as a threat, which is
 * how two disagreeing rules get born.
 */
export class GrenadeField {
  constructor(world) {
    this.world = world;
    this.scene = world?.scene ?? null;
    this.list = [];
    this.stats = { thrown: 0, blown: 0, returned: 0, smothered: 0, dived: 0 };
  }

  /**
   * WHOSE `blast` THIS IS, and it is not the World's — it is the PLAYER'S.
   *
   * `Stratagems` is constructed by `Player` (`this.stratagems = new
   * Stratagems(this)`), because a support call is something a person spells
   * out. `world.stratagems` has never existed, so the first version of this
   * line read `world.stratagems ?? null` and every grenade in the game went off
   * with `S?.blast?.()` — optional-chained into silence, which is this
   * project's signature defect and the exact shape HANDOFF §2.3 warns about: a
   * missing thing answered with a plausible default. Measured by the check that
   * caught it: five men standing on top of a detonation, 230 hp before and 230
   * hp after.
   *
   * The fallback down the players list is for a World whose local player has
   * died or has not spawned yet — a grenade in the air when its thrower's
   * target dies still has to go off.
   */
  get stratagems() {
    const w = this.world;
    if (!w) return null;
    if (w.player?.stratagems) return w.player.stratagems;
    for (const p of (w.players || [])) if (p?.stratagems) return p.stratagems;
    return null;
  }

  /**
   * Throw one. `to` is where it is aimed — the thrower's own aim error is the
   * caller's business, because a B1 and a clone veteran do not throw alike.
   */
  throw(from, to, opts = {}) {
    const g = new LiveGrenade(this, from, to, opts);
    this.list.push(g);
    this.stats.thrown++;
    return g;
  }

  /**
   * THE NEAREST LIVE THREAT TO THIS BODY, or null.
   *
   * IT DOES NOT TAKE A SIDE, and that is deliberate rather than an omission:
   * a soldier reacts to a grenade whoever threw it, including one of his own
   * army's that has just been thrown back at him — which is the second half of
   * what makes throwing one back a real decision. An earlier version of this
   * comment described a `team` parameter that the signature never had, which
   * is the same defect as a field nothing reads, written the other way round.
   */
  nearest(position, within = NOTICE) {
    let best = null, bestD = within;
    for (const g of this.list) {
      if (g.dead) continue;
      const d = g.position.distanceTo(position);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  update(dt, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.update(dt, ctx);
      if (g.dead) this.list.splice(i, 1);
    }
  }

  clear() {
    for (const g of this.list) g.dispose();
    this.list.length = 0;
  }

  dispose() { this.clear(); }
}

/* ── the reactions themselves ─────────────────────────────────────────── */

/**
 * How brave this body is, 0..1 — and it is READ rather than rolled.
 *
 * A Command trooper carries a morale record and a rank, and both are already on
 * screen: the nameplate draws his nerve bar and his rank chip. So the man who
 * throws himself on a grenade is a man the player could have picked out
 * beforehand, which is the difference between a character and a coin toss.
 * Bodies with no record — the horde — answer with their archetype's TEMPER, a
 * B1 being a B1 and an ARC being an ARC, scaled by whatever nerve that body has
 * left.
 *
 * ── IT WAS `nerveOf`, AND THERE WERE TWO OF THOSE ────────────────────────
 *
 * `Nerve.nerveOf` and this one were two exported functions with one name
 * answering one question two different ways, which is HANDOFF §2.3's signature
 * defect with the twin sitting in a different file. This one is `braveryOf`
 * now: bravery is a TEMPERAMENT crossed with a state, and the state is the
 * ledger. Nothing outside this file imported the old name.
 *
 * ── AND THE HORDE'S HALF WAS A CONSTANT ──────────────────────────────────
 *
 * The header of this file says the choice between the four answers is "made
 * out of state this game already keeps rather than out of a die roll … how
 * much NERVE the man has". For a body with a record that was true. For the
 * horde — which is every body in waves, roguelite, campaign and skirmish — it
 * read `(threat - 1) / 6` and NOTHING ELSE: a per-archetype constant fixed at
 * spawn, so a droid that had watched half its rank cut down in front of it was
 * exactly as willing to lie on a grenade as one that had just walked in.
 *
 * `Enemy.nerve` is a real number that a real thing moves — `nerveTick` pays
 * -0.115/s for a lit hostile blade inside `BLADE_REACH` and `witnessDeath`
 * -0.055 for every body that falls within `SEE` — and it is read by
 * `Enemy._think`'s break clause and by `nerveAim`. This chooser, the one place
 * in the game where nerve decides an ACT rather than a wobble, was the reader
 * that did not have it.
 *
 * AT FULL NERVE AND OUTSIDE A LEADER'S RING THIS IS THE OLD NUMBER EXACTLY —
 * `NERVE.START` is 1 and the product is the identity — so nothing in the
 * shipped game moves until the player has done something to the body, which is
 * the same argument `NERVE.START`'s own note makes.
 *
 * The rally term is in both branches now for the same reason it was in one: a
 * `leader` elite writes `rallyTimer` onto every body of its OWN side inside its
 * ring, horde or roster alike, and a man being led is a man who will try
 * something.
 */
export function braveryOf(body) {
  const t = body.trooper;
  if (t) {
    const rank = (t.rank ?? 0) / 4;
    return clamp((t.morale ?? 0.6) * 0.72 + rank * 0.28 + (body.rallyTimer > 0 ? 0.1 : 0), 0, 1);
  }
  const temper = clamp(((body.A?.threat ?? 2) - 1) / 6, 0, 1);
  return clamp(temper * clamp(ledgerNerve(body), 0, 1) + (body.rallyTimer > 0 ? 0.1 : 0), 0, 1);
}

/** Friends of this body inside a radius — who a smother would be saving. */
function friendsNear(body, at, radius, ctx) {
  const list = ctx?.enemies || body.world?.enemies || [];
  let n = 0;
  const r2 = radius * radius;
  for (const o of list) {
    if (o === body || o.dead) continue;
    if (o.team !== body.team) continue;
    if (o.position.distanceToSquared(at) <= r2) n++;
  }
  return n;
}

/** The nearest hostile, for a man deciding where to throw one back. */
function foeNear(body, ctx) {
  const list = ctx?.enemies || body.world?.enemies || [];
  let best = null, bestD = Infinity;
  for (const o of list) {
    if (o.dead || o.team === body.team) continue;
    const d = o.position.distanceToSquared(body.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  const p = body.world?.player;
  if (p && p.alive && p.team !== body.team) {
    const d = p.position.distanceToSquared(body.position);
    if (d < bestD) return p;
  }
  return best;
}

/**
 * DECIDE — and the order of these branches IS the design.
 *
 * Read top to bottom it is what a man's attention actually does: the thing is
 * close enough to kill me, so first, can I get rid of it; if I cannot, is
 * anyone behind me; and if neither, get out of the way. The expensive answers
 * are gated hardest and the cheap one is always available, so no body ever
 * stands still because it failed three tests.
 */
export function chooseReaction(body, g, ctx) {
  const d = body.position.distanceTo(g.position);
  if (d > GRENADE.radius + 2.5) return null;             // it cannot reach him
  /**
   * NOT WHILE IT IS STILL IN THE AIR — and this was worth a whole failing
   * check to find. A body notices a grenade the moment it is thrown, and two
   * of the four answers require picking it up, so deciding at that moment
   * meant every man in the squad committed to a DIVE while the thing was still
   * flying and none of them ever considered the other two. Measured: five
   * brave men around a grenade landing at their feet, zero smothers.
   *
   * So a man who has time watches it land. `0.9` is the throw-back's own
   * requirement — below it there is no time to reach the thing anyway — so
   * waiting costs nothing that was reachable.
   */
  if (!g.grounded && g.left > 0.9) return null;
  const nerve = braveryOf(body);
  const left = g.left;

  /**
   * LIE ON IT, AND THIS BRANCH IS FIRST FOR A REASON THE FIRST DRAFT GOT
   * WRONG.
   *
   * Throwing it back was tried first on the reasoning that getting rid of the
   * thing is always better. Measured, that made the smother almost unreachable:
   * a brave man is exactly the man who passes the throw-back gate, so the
   * bravest soldier at ground zero picked it up every time and the behaviour
   * the player asked for by name happened in a window about a fifth of a second
   * wide.
   *
   * And it is wrong about the situation as well as about the outcome. `SMOTHER`
   * is 1.8 m — a man standing ON it. From there a throw is not a way out for
   * the people around him: the thing is at his feet, the fuse is what it is,
   * and anything he can do with his arms in that time leaves it inside the
   * radius he is standing in. Covering it is the only act available that
   * changes what happens to the men behind him, which is why a man does it.
   *
   * Further out, where there is room to wind up and somewhere to throw it, the
   * branch below wins — and that IS the ordering a soldier uses.
   */
  if (g.grounded && d < SMOTHER.range && left > 0.25 && nerve > NERVE.smother && !g.smotheredBy
      && friendsNear(body, g.position, GRENADE.radius * 0.8, ctx) >= 2) {
    return { kind: 'smother', t: 0, g };
  }
  /* THROW IT BACK. He has to be able to reach it, and there has to be enough
   * fuse left to be worth trying — a man who tries it at 0.6 is the man the
   * player asked for ("sometimes killing themselves"), because nothing here
   * stops the fuse. */
  if (g.grounded && d < 4.2 && left > 0.55 && nerve > NERVE.throwBack && !g.carrier) {
    return { kind: 'throwback', t: 0, g };
  }
  /* GET OUT. Always available, and the only one with no gate at all. */
  _v1.subVectors(body.position, g.position).setY(0);
  /* Standing exactly on it is the one case with no direction in it, and a
   * normalise there is a NaN that stops the body for ever. Any way is out. */
  if (_v1.lengthSq() < 1e-4) _v1.set(Math.cos(jitterOf(body) * 6.283), 0, Math.sin(jitterOf(body) * 6.283));
  return { kind: 'dive', t: 0, g, dir: _v1.normalize().clone() };
}

/** How long each reaction owns the body for. */
const DIVE = { launch: 0.16, speed: 9.5, prone: 0.85, up: 0.45 };
const THROW = { reach: 0.9, wind: 0.22, range: 22 };
/** `range` is how close a man has to be to cover one rather than throw it —
 *  see the branch order in `chooseReaction`. 1.8 m is standing on it. */
const SMOTHER = { launch: 0.2, speed: 7.0, range: 1.8 };

/**
 * ONE FRAME OF WHATEVER THIS BODY IS DOING ABOUT IT.
 *
 * Returns true while the reaction owns the body — the caller must then skip its
 * brain and its steering entirely, because a man diving away from a grenade who
 * is also being told to hold formation is a man who does neither.
 */
export function stepReaction(body, dt, ctx) {
  const R = body.reaction;
  if (!R) return false;
  if (body.dead) { body.reaction = null; return false; }
  R.t += dt;
  const g = R.g;

  if (R.kind === 'dive') {
    if (R.t < DIVE.launch) {
      /* THE LEAP. Velocity outright rather than a wish, because a wish is
       * damped toward a walk speed and this is not walking — `_move` damps at
       * 8/s, so a dive expressed as a wish takes a fifth of a second to reach
       * a speed the grenade does not give him. */
      body.velocity.x = R.dir.x * DIVE.speed;
      body.velocity.z = R.dir.z * DIVE.speed;
      if (body.grounded) { body.velocity.y = 2.2; body.grounded = false; }
      body.wish = null;
    } else if (R.t < DIVE.launch + DIVE.prone) {
      /* FLAT ON THE GROUND. `crouch` is the pose the rig already has and every
       * consumer already reads; 1 is as low as a body goes. */
      body.crouch = 1;
      body.wish = null;
      body.velocity.x = damp(body.velocity.x, 0, 6, dt);
      body.velocity.z = damp(body.velocity.z, 0, 6, dt);
    } else if (R.t < DIVE.launch + DIVE.prone + DIVE.up) {
      body.crouch = damp(body.crouch ?? 1, 0, 8, dt);
      body.wish = null;
    } else {
      body.crouch = 0;
      body.reaction = null;
      return false;
    }
    return true;
  }

  if (R.kind === 'throwback') {
    if (g.dead) { body.reaction = null; return false; }
    const d = body.position.distanceTo(g.position);
    if (!R.held) {
      if (d > 1.1 && R.t < THROW.reach) {
        /* Go and get it — at a run, and this one IS a wish, because he is
         * covering ground rather than throwing himself. */
        if (!body.wish) body.wish = new THREE.Vector3();
        body.wish.subVectors(g.position, body.position).setY(0).normalize();
        body.speed = Math.max(body.speed, (body.A?.speed ?? 4) * 1.35);
        return true;
      }
      if (d > 1.6) {
        /* He could not reach it in time. Everything else is still open to him,
         * which is why this falls back into `chooseReaction` rather than into
         * standing there. */
        body.reaction = chooseReaction(body, g, ctx);
        return !!body.reaction;
      }
      R.held = true;
      R.at = R.t;
      g.carrier = body;
      body.crouch = 0;
      return true;
    }
    /* HELD. He winds up and throws — and if the fuse beats him to it, it goes
     * off in his hand, which needs no code: `LiveGrenade.update` keeps burning
     * while `carrier` is set and `detonate` uses his own position. */
    if (R.t - R.at < THROW.wind) { body.wish = null; return true; }
    const foe = foeNear(body, ctx);
    const to = foe
      ? _v2.copy(foe.position)
      : _v2.copy(body.position).addScaledVector(
        _v3.set(Math.cos(jitterOf(body) * 6.28), 0, Math.sin(jitterOf(body) * 6.28)), THROW.range);
    /* HE IS NOT A MARKSMAN, and this is the second half of "sometimes killing
     * themselves": a hurried throw scatters, and a scatter that lands short is
     * a grenade back among his own feet. */
    const err = (1 - braveryOf(body)) * 5.5;
    to.x += (jitterOf(body) - 0.5) * err;
    to.z += (jitterOf(body) * 1.7 % 1 - 0.5) * err;
    _v1.copy(body.position);
    _v1.y += (body.A?.hipHeight ?? 0.95) + 0.4;
    g.relaunch(_v1, to);
    g.field.stats.returned++;
    /* AND HE GETS AWAY FROM IT — away from where he has just sent it, not away
     * from where it is, because at this instant it is still in his own hand
     * and `body.position - g.position` is a vector of nothing, which
     * normalises to NaN and stops him dead on the spot. */
    _v3.subVectors(body.position, g.to).setY(0);
    if (_v3.lengthSq() < 1e-4) _v3.set(1, 0, 0);
    body.reaction = { kind: 'dive', t: 0, g, dir: _v3.normalize().clone() };
    return true;
  }

  if (R.kind === 'smother') {
    if (g.dead) { body.reaction = null; return false; }
    const d = body.position.distanceTo(g.position);
    if (d > 0.8) {
      _v1.subVectors(g.position, body.position).setY(0).normalize();
      body.velocity.x = _v1.x * SMOTHER.speed;
      body.velocity.z = _v1.z * SMOTHER.speed;
      body.wish = null;
      body.crouch = 1;
      return true;
    }
    /* ON IT. He is not getting up; the only thing left is the blast. */
    g.smotheredBy = body;
    body.crouch = 1;
    body.wish = null;
    body.velocity.x = damp(body.velocity.x, 0, 10, dt);
    body.velocity.z = damp(body.velocity.z, 0, 10, dt);
    return true;
  }

  if (R.kind === 'drag') return stepDrag(body, dt, ctx, R);
  /* THE SAME ACT POINTED THE OTHER WAY — see `stepGrab`. A drag is a man
   * taking his mate somewhere; a grab is a man refusing to let his mate be
   * taken. Same fistful of collar, same two numbers. */
  if (R.kind === 'grab') return stepGrab(body, R);

  body.reaction = null;
  return false;
}

/**
 * THE ONE THAT IS NOT ABOUT GRENADES — "dragging their friends to safety".
 *
 * A casualty in this game is a body that is limp and alive: `Enemy._tickGetUp`
 * stands one up after `GET_UP` seconds of lying still, so a man who has been
 * shoved, blasted or thrown is on the floor and helpless for a moment, and
 * until now every soldier beside him carried on shooting.
 *
 * The drag is deliberately SLOW — the pair move at a third of a walk — because
 * the whole content of it is that the man doing it has stopped fighting. It is
 * also the only reaction with no clock: he stops when the casualty is on his
 * feet, when the ground he is heading for is behind him, or when he is hit.
 */
/** `haul` is the strength `Ragdoll.suspend` drives the casualty's chest at.
 *  Far gentler than a Force grip's 12: this is a man with a fistful of collar,
 *  and at 12 the body arrives ahead of the person pulling it. */
/**
 * `speed` is the fraction of a walk the pair move at and `haul` is the
 * strength `Ragdoll.suspend` drives the casualty's chest at.
 *
 * BOTH WENT UP WHEN THE DRAG STOPPED WORKING BY ACCIDENT. While the body was
 * being shoved along by its own collision capsule (see `stepDrag`, and the
 * `dragTo` that never existed) the casualty travelled rigidly at whatever pace
 * the dragger walked; hauled properly through the joint solve it lags, which
 * is what it should look like and is also slower. Measured over the same eight
 * seconds: 2.38 m at 0.34 and 3.6 m at 0.45.
 *
 * `haul` is far gentler than a Force grip's 12 on purpose — this is a man with
 * a fistful of collar, and at 12 the body arrives ahead of the person pulling
 * it.
 */
const DRAG = { reach: 1.4, speed: 0.45, safe: 9, look: 11, haul: 4.2 };
/** How long a claim on a casualty survives its claimant. See `startDrag`. */
export const DRAG_LEASE = 0.5;
/** How hurt a man has to be before somebody goes back for him. See
 *  `findCasualty` — above this he is standing up on his own in a moment. */
export const DRAG_HURT = 0.45;

export function findCasualty(body, ctx) {
  const list = ctx?.enemies || body.world?.enemies || [];
  let best = null, bestD = DRAG.look * DRAG.look;
  for (const o of list) {
    if (o === body || o.dead || o.team !== body.team) continue;
    if (!o.actor?.ragdolled || o.beingDragged) continue;
    /**
     * A MAN WHO IS ABOUT TO STAND UP DOES NOT NEED CARRYING, and leaving this
     * out cost a whole check to notice. `Enemy._tickGetUp` puts any living body
     * back on its feet after `GET_UP` seconds of lying still, so EVERY shove,
     * blast and Force throw in the game produces a "casualty" for a second and
     * a third — and a line that dropped what it was doing for each of them
     * stopped being a line. Measured on Command's own idle-army check: the
     * roster's kills fell from three to one.
     *
     * `DRAG_HURT` is the difference between a man who has been knocked over and
     * a man who is hurt: under 45% he is worth going back for, and above it he
     * is getting up by himself in a moment.
     */
    if (o.hp > (o.maxHp ?? 1) * DRAG_HURT) continue;
    const d = o.position.distanceToSquared(body.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

export function startDrag(body, casualty, ctx) {
  if (!casualty || casualty.beingDragged) return false;
  /* WHERE SAFETY IS: away from whatever he is facing, which is where the
   * shooting is coming from. A drag toward a named piece of cover would need a
   * cover system this game does not have; away from the enemy is what a man
   * does and it is honest about what it knows. */
  const foe = foeNear(body, ctx);
  const away = foe
    ? _v1.subVectors(body.position, foe.position).setY(0).normalize()
    : _v1.set(Math.cos(jitterOf(body) * 6.28), 0, Math.sin(jitterOf(body) * 6.28));
  /**
   * A LEASE, NOT A LATCH — and it is the same lesson `Enemy.hold` learned the
   * hard way. `beingDragged` is what stops ten men grabbing the same casualty,
   * and a claim that is only cleared by the one code path that ends a drag
   * cleanly is a claim that leaks the first time a dragger dies, is thrown, or
   * has his reaction replaced by a grenade landing next to him — and a
   * casualty nobody can ever help again is worse than one nobody helped.
   * `stepDrag` renews it every frame; `Enemy._tickGetUp` lets it lapse.
   */
  casualty.beingDragged = body;
  casualty.dragLease = DRAG_LEASE;
  body.reaction = {
    kind: 'drag', t: 0, casualty,
    to: casualty.position.clone().addScaledVector(away, DRAG.safe),
  };
  return true;
}

function stepDrag(body, dt, ctx, R) {
  const c = R.casualty;
  if (c && c.beingDragged === body) c.dragLease = DRAG_LEASE;
  const stop = (why) => {
    if (c) c.beingDragged = null;
    body.reaction = null;
    body.dragWhy = why;
    return false;
  };
  if (!c || c.dead) return stop('lost');
  if (!c.actor?.ragdolled) return stop('up');
  if (R.t > 12) return stop('timeout');
  const d = body.position.distanceTo(c.position);
  if (d > DRAG.reach + 0.4) {
    if (!body.wish) body.wish = new THREE.Vector3();
    body.wish.subVectors(c.position, body.position).setY(0).normalize();
    return true;
  }
  /* HAULING. He walks backwards toward safety and the casualty comes with him
   * — moved through the ragdoll's own centre so the limbs trail, which is what
   * makes it read as a body being pulled rather than a second man walking. */
  if (!body.wish) body.wish = new THREE.Vector3();
  body.wish.subVectors(R.to, body.position).setY(0);
  const left = body.wish.length();
  if (left < 1.2) return stop('safe');
  body.wish.normalize();
  body.speed = (body.A?.speed ?? 4) * DRAG.speed;
  body.crouch = 0.45;
  /**
   * AND THE BODY COMES WITH HIM — through `Ragdoll.suspend`, which is the
   * shipped way to move a limp body and the same call `Player`'s Force grip
   * uses.
   *
   * THIS LINE READ `c.actor?.dragTo?.(c.position)` AND `dragTo` DOES NOT
   * EXIST. One grep hit in the whole repository, and it was the call site: the
   * optional chain swallowed it and the drag appeared to work, because
   * `Enemy._syncBody` teleports the collision capsule to `this.position` every
   * frame and the capsule shoves the ragdoll along behind it. That is this
   * project's signature defect — a missing thing answered with a plausible
   * default (HANDOFF §2.3) — and it had a consequence you could see: measured
   * over a 2.60 m drag, the man stood up 1.90 m from where the ragdoll actually
   * lay, because `Enemy.recover` puts a body where its bones are and the bones
   * were being dragged by accident rather than on purpose.
   *
   * `suspend` drives the chest and lets the joints carry the rest, so the limbs
   * trail — which is also what makes it look like a man being pulled rather
   * than a second man walking.
   */
  _v2.subVectors(body.position, c.position).setY(0);
  const gap = _v2.length();
  if (gap > DRAG.reach * 0.65) {
    _v3.copy(body.position).addScaledVector(_v2.normalize(), -DRAG.reach * 0.65);
    _v3.y = c.position.y;
    if (!c.actor?.suspend?.(_v3, dt, DRAG.haul)) {
      /* No ragdoll to drive — a stand-in in a check, or a body whose actor has
       * gone. The capsule still moves, which is the old behaviour and is
       * better than the drag silently doing nothing. */
      c.position.addScaledVector(_v2, gap - DRAG.reach * 0.65);
    }
    c.actor?.centre?.(c.position);
  }
  return true;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  A SQUADMATE GRABS THE MAN YOU ARE GRIPPING — PLAN §4.8, second bullet
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"One joint, one break force: a gripped body reaches for the nearest collider
 * and a squadmate grabs him. Grip one, drag two, the contest resolving against
 * combined mass."*
 *
 * ── IT IS THE DRAG, TURNED ROUND, AND THAT IS WHY IT IS HERE ─────────────
 *
 * `stepDrag` above is already a man with a fistful of another man's collar,
 * hauling him through `Ragdoll.suspend` at `DRAG.haul` from `DRAG.reach` away,
 * with a `DRAG_LEASE` claim so ten men cannot grab one. Every one of those is
 * exactly what this needs: the ONLY difference is which end is going somewhere.
 * A drag is a man taking his mate out of the beaten zone; a grab is the same
 * man refusing to let the Force take his mate anywhere. Written as a second
 * file's worth of reach, strength and claim it would be four numbers to retune
 * twice; written here it is the same four.
 *
 * ── THE JOINT, AND WHY IT IS `Enemy.hold` ───────────────────────────────
 *
 * A man hanging off a body that is three metres in the air is a body being
 * held aloft by something, and this game already has exactly one statement of
 * that: `gripped` + `liftTarget`, which ragdolls him, suspends him by the
 * chest, follows his position off the ragdoll's own centre, reports his real
 * velocity, keeps his brain out of the frame and stops him shooting. So the
 * grabber is HELD — by the man he has hold of rather than by the Force — and
 * not one line of movement code is written here. `hold`'s second argument is
 * the whole difference between the two holders: the Force drives at
 * `Ragdoll.suspend`'s own 12 and a pair of arms drives at `DRAG.haul` = 4.2.
 *
 * ── ONE BREAK FORCE, READ OFF THOSE TWO NUMBERS ─────────────────────────
 *
 * `suspend` commands the chest at `(target − chest) × strength` and the target
 * is anchored `DRAG.reach` from the man he is holding, so an arm at full
 * stretch can never command more than `DRAG.haul × DRAG.reach` = 5.88 m/s.
 * That is the break force, in the units the solver actually works in, and it
 * is `GRAB_BREAK` below. The load on the joint is `DRAG.haul × over`, where
 * `over` is how far past its own length the link has been pulled — so the link
 * is over its limit exactly when `over > DRAG.reach`, and a link driven toward
 * a point receding at `v` settles at `over = v / DRAG.haul`. Put together:
 *
 *     drag the pair slower than GRAB_BREAK and he holds on — you drag two men
 *     drag the pair faster  than GRAB_BREAK and the joint is torn off him
 *
 * THE MASS CANCELS, and it should: an inextensible link transmits whatever it
 * takes, so what decides a break is how fast the far end is going and not how
 * heavy either man is. The WEIGHT decides the other half of this bullet, and
 * it decides it somewhere else entirely — `Enemy.heldMass` against
 * `Player.liftCapacity`, `_heft` and `_holdRate`. Two halves, two rules, and
 * neither of them typed twice.
 *
 * ── AND THE OTHER WAY OUT IS FREE ───────────────────────────────────────
 *
 * A man can only take hold of what he can reach: `reachForHelp` refuses a body
 * more than `DRAG.reach` above his own feet. So lifting the man you have
 * gripped over his squad's heads is counter-play that costs nothing but the
 * decision to do it — which is the same shape as breaking a guard in the first
 * bullet, and it is why neither of these is a delay dressed as a choice.
 */

/**
 * The fastest a pair of arms can follow, in m/s, and the one threshold this
 * whole behaviour has. Derived, not chosen — see the block above.
 */
export const GRAB_BREAK = DRAG.haul * DRAG.reach;

/**
 * A GRIPPED BODY REACHES FOR THE NEAREST COLLIDER — the bullet's own sentence,
 * and the reason the scan lives on the man being lifted rather than on every
 * soldier on the field.
 *
 * Called from `Enemy.update` only while `gripped`, so the cost is one pass over
 * the roster per body the Force is actually holding — at most a handful, and
 * nothing at all in the overwhelming majority of frames. The mirror image
 * (every soldier asking every frame whether anybody nearby is being lifted) is
 * the same answer at N times the price.
 *
 * The gates are all somebody being able to DO it, rather than a die roll:
 *
 *   · his own team, and he is on his feet, and his hands are free (no reaction
 *     of his own, not held, not being dragged, not down);
 *   · the man is within `DRAG.reach` OF THE GROUND HE IS STANDING ON. Lift him
 *     higher and there is nothing to grab. That is the free counter-play;
 *   · nobody has him already — `grabbedBy` is the claim, and ONE joint is what
 *     the bullet asks for.
 *
 * A man torn off is ragdolled by the break, so `!ragdolled` is his own cooldown
 * and there is no second clock: he is out of the running until he has stood
 * back up, which `Enemy._tickGetUp` already takes `GET_UP` seconds over.
 */
export function reachForHelp(held, ctx) {
  if (!held || held.dead || held.grabbedBy || held.noReact) return null;
  const list = ctx?.enemies || held.world?.enemies || [];
  let best = null, bestD = DRAG.look * DRAG.look;
  for (const o of list) {
    if (o === held || o.dead || o.team !== held.team || o.noReact) continue;
    if (o.reaction || o.gripped || o.beingDragged || o.downed) continue;
    if (!o.actor || o.actor.ragdolled) continue;
    /* A SQUADMATE, WHICH IS A MAN. Three exclusions and none of them is a new
     * flag: `grippable === false` is the archetype's own "this is terrain that
     * shoots, not a body" (see Vehicles.js and `Player._liftRefusal`), `driven`
     * is a man already at the controls of one, and `A.big` is the same
     * not-man-sized flag the choke halves its rate for. A hailfire droid
     * reaching out to steady a battle droid is the hand-written-table defect
     * wearing a reaction. */
    if (o.grippable === false || o.driven || o.A?.big) continue;
    /* OUT OF REACH IS OUT OF REACH. Measured off his feet, because that is
     * what he is standing on and what he would have to jump from. */
    if (held.position.y - o.position.y > DRAG.reach) continue;
    const d = o.position.distanceToSquared(held.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best && startGrab(best, held) ? best : null;
}

/**
 * ONE JOINT AND ONE CLAIM. `grabbedBy` is to a grab what `beingDragged` is to a
 * drag and it lapses the same way, in `Enemy._tickGetUp`, off `grabLease` —
 * because a claim only ever cleared by the code path that ends cleanly is a
 * claim that leaks the first time the man holding it is shot.
 */
export function startGrab(body, held) {
  if (!body || !held || held.grabbedBy || body.reaction) return false;
  held.grabbedBy = body;
  held.grabLease = DRAG_LEASE;
  body.reaction = { kind: 'grab', t: 0, held, on: false };
  return true;
}

function stepGrab(body, R) {
  const c = R.held;
  const stop = (why) => {
    if (c && c.grabbedBy === body) { c.grabbedBy = null; c.grabLease = 0; c.grabLoad = 0; }
    /* HIS OWN HOLD GOES WITH IT, and it goes here rather than being left to
     * lapse: `grabLease` is half a second, and half a second of a man hanging
     * in the air off a body he is no longer holding is the same stranded body
     * `GRIP_LEASE`'s own note exists about. He is limp when he lets go, so he
     * falls, and `_tickGetUp` stands him up on the clock it already runs. */
    if (R.on) body.releaseHold();
    body.reaction = null;
    body.grabWhy = why;
    return false;
  };
  if (!c || c.dead || body.dead) return stop('lost');
  /* A GRAB IS A GRAB ON A MAN THE FORCE HAS HOLD OF. Released, thrown or
   * choked to death, the grip ends and so does this — which is also what makes
   * `hurlGripped` and `releaseGrip` need no line of their own here. */
  if (!c.gripped) return stop('free');
  c.grabbedBy = body;
  c.grabLease = DRAG_LEASE;

  const to = _v1.subVectors(body.position, c.position);
  const gap = to.length();

  /* HE HAS TO GET HIS HANDS ON HIM FIRST — `stepDrag`'s own approach branch,
   * and the same 0.4 m of slack over the reach so a man at the edge of it is
   * not switching between walking and hauling every other frame. The height
   * gate is re-read here and not only at the claim: a body lifted away while
   * he is still running at it is a body he never reaches. */
  if (!R.on) {
    if (c.position.y - body.position.y > DRAG.reach) return stop('high');
    if (gap > DRAG.reach + 0.4) {
      if (!body.wish) body.wish = new THREE.Vector3();
      body.wish.subVectors(c.position, body.position).setY(0).normalize();
      return true;
    }
    R.on = true;
  }

  /* ONE BREAK FORCE. `DRAG.haul × over` is what the link is being asked to
   * pull with; `GRAB_BREAK` is the most an arm at full stretch can ever pull
   * with. Over it, his fingers come off. See the block above for why the two
   * masses are absent from both sides of this line. */
  const over = gap - DRAG.reach;
  if (DRAG.haul * over > GRAB_BREAK) return stop('torn');

  /* THE JOINT ITSELF: he hangs `DRAG.reach` from the man he is holding, in
   * whatever direction he already is, driven at a man's strength rather than
   * the Force's. Everything that moves him is `Enemy._move`'s held branch. */
  if (gap > 1e-4) to.multiplyScalar(1 / gap); else to.set(0, -1, 0);
  body.hold(DRAG_LEASE, DRAG.haul);
  body.liftTarget = (R.at ||= new THREE.Vector3())
    .copy(c.position).addScaledVector(to, DRAG.reach);
  /* AND WHAT HE WEIGHS IS NOW ON THE FORCE. Written every frame and lapsed
   * with the claim, so a grabber who is shot stops being a load on the man he
   * was holding without anybody having to remember to say so. See
   * `Enemy.heldMass`, which is the only thing that reads it. */
  c.grabLoad = body.A?.mass ?? 80;
  return true;
}

/**
 * WHO NOTICES, AND WHO IS TOLD — the whole of why this reads as a squad.
 *
 * Called once per body per frame from `Enemy.update`. It is cheap on purpose:
 * one distance test against the nearest live grenade, and everything else is
 * behind that.
 */
export function senseDanger(body, dt, ctx) {
  const field = body.world?.grenades;
  /* `noReact` is a body that must not: a training remote, and the control arm
   * of any measurement that wants this system's contribution isolated —
   * `tools/checks/reactions.mjs` runs the same scene twice and the difference
   * IS the feature, which cannot be measured by clearing `reaction` every
   * frame (that leaves the body mid-leap with its velocity already spent). */
  if (body.noReact) return;
  /* `_sawG` GOES WITH IT. Clearing only the clock left every body on the field
   * holding a pointer to the last grenade that went off, for the rest of its
   * life — a retained reference to a disposed object, and worse, a body whose
   * `_sawG` still matches would skip its own reaction time if that object were
   * ever reused. */
  if (!field || !field.list.length) { body._dangerT = 0; body._sawG = null; return; }
  const g = field.nearest(body.position, NOTICE);
  if (!g || g.dead) { body._dangerT = 0; body._sawG = null; return; }
  if (body._sawG !== g) {
    body._sawG = g;
    body._dangerT = 0;
    /* HIS OWN REACTION TIME, and a shout takes most of it off everybody
     * else's. `_heard` is stamped by the shouter below. */
    /* …AND `shaken` IS THE LEDGER TOO. `body.trooper?.morale ?? 1` answered a
     * flat 1 for every body in the horde, so `LAG.shaken` — "a frightened man
     * freezes first", the slowest of the three reaction times — could only ever
     * be paid by a named trooper in Command. Every droid in the game reacted at
     * a steady soldier's pace whatever had just happened to it. One reader. */
    const shaken = ledgerNerve(body) < 0.4;
    const heard = body._heardAt !== undefined && (ctx?.time ?? 0) - body._heardAt < 1.2;
    body._lag = (heard ? LAG.heard : (shaken ? LAG.shaken : LAG.base))
      + jitterOf(body) * LAG.jitter;
  }
  body._dangerT += dt;
  if (body._dangerT < body._lag) return;
  if (body.reaction) return;

  /* THE SHOUT. The first man to act on it yells, and everybody of his side who
   * can hear him has their own lag cut to `LAG.heard`. One shout per grenade,
   * so a squad of eight does not produce eight. */
  /* ONE SHOUT PER SIDE, NOT PER GRENADE. `_shouted` was a single latch on the
   * object, so a grenade landing between two lines cued whichever of them
   * noticed first and left the other one standing — while the comment claimed
   * "everybody of his side". A Set of team numbers is the same rule actually
   * expressed: each side gets its own warning, once. */
  if (!g._shouted) g._shouted = new Set();
  if (!g._shouted.has(body.team)) {
    g._shouted.add(body.team);
    const list = ctx?.enemies || body.world?.enemies || [];
    const t = ctx?.time ?? 0;
    for (const o of list) {
      if (o.dead || o.team !== body.team) continue;
      if (o.position.distanceToSquared(body.position) > 400) continue;   // 20 m
      o._heardAt = t;
      if (o._sawG === g && !o.reaction) o._lag = Math.min(o._lag ?? LAG.base, LAG.heard);
    }
    body.world?.notifyFloating?.(body.position, 'GRENADE!', 0xffb347);
    audio.tone({ freq: 300, freqEnd: 220, dur: 0.22, gain: 0.10, type: 'square', pos: body.position });
  }

  const R = chooseReaction(body, g, ctx);
  if (R) {
    body.reaction = R;
    if (R.kind === 'dive') field.stats.dived++;
  }
}
