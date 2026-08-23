/**
 * BATTLEFRONT BORZ — THE CURRENCY THE JEDI CANNOT PROVIDE.
 *
 * PLAN.md §4.2. Six things standing on the field that a side HOLDS by having
 * men standing on them, each of which pays something the player cannot buy any
 * other way, and every one of which is paid for in the one currency this mode
 * is actually about.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE CLAUSE THAT MAKES THIS A DESIGN AND NOT A LIST
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A gun without a crew is scenery. The Jedi cannot crew a battery and fight at
 * the same time — he is one body and there is one of him — so the men who crew
 * it are named men off the roll, and:
 *
 *     CREWING TAKES THOSE MEN OUT OF THE QUORUM.
 *
 * `CommandDirector.lineGathered` counts half the living standing where they
 * were told to stand, and a man on a gun is not counted. So every objective you
 * hold is ground you cannot advance onto, artillery is bought with the same
 * currency as movement, and the decision every minute is which of the two you
 * need. PLAN.md's own test of this section is that it must not "read
 * identically with `lineIsUp` deleted", and that one clause is what makes it
 * fail that test in the right direction.
 *
 * It is also why this file adds no assignment UI. A site is crewed by whoever
 * is standing on it — which means the way you crew a battery is to give a squad
 * the standing order to hold it (`CommandDirector.order(id, cmdr, squad)`), and
 * the delegation that shipped for §4.4 is the interface for §4.2 without a
 * single new verb. One mechanism, two sections.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT EACH ONE PAYS, AND WHAT IT COSTS TO LOSE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every effect below is routed through the system that already owns it. None of
 * them is a new subsystem wearing an objective's name:
 *
 *   BATTERY   held: `WarSupport.credit` pays a barrage's worth on a clock, so
 *             the gun is off-map firepower you did not have to earn by killing.
 *             lost: the same clock spends their support on your line instead.
 *   RELAY     held: `Stratagems` cooldowns run at double rate.
 *             lost: they run at half.
 *   PAD       held: a gunship pass every so often, through `Stratagems`' own
 *             strafe. lost: their gunship, on the same clock, on you.
 *   SPIRE     held: `Contact` marks every hostile on the field rather than the
 *             ones you have seen. lost: it marks yours, to them, and yours go
 *             dark past the horizon.
 *   FOUNDRY   held: a replacement wave brings a heavy rung.
 *             lost: theirs does.
 *   SHIELD    held: an approach is uncrossable to them.
 *             lost: it is uncrossable to you.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  HELD, LOST, AND THE THIRD STATE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A site is held by the side with at least `crew` living bodies inside its
 * radius. Both sides over the bar is CONTESTED and pays nobody, which is the
 * state a good objective spends most of its time in and the reason the count is
 * a threshold rather than a majority: a majority always names a winner, and a
 * fight over a gun should be able to stop the gun without either side getting
 * it.
 *
 * A site changes hands on a HOLD TIMER rather than instantly. One man walking
 * through the radius must not flip a battery, and a side that has fought its way
 * on has to keep men there through the counter-attack — which is the only way
 * the "and lose it" half of the table is ever felt.
 */

import * as THREE from 'three';
import { propMaterials } from '../world/Props.js';
import { clamp } from '../engine/MathUtil.js';

/**
 * How long a side has to be the only one over the bar before the site changes
 * hands, in seconds.
 *
 * Long enough that a squad walking past does not take a battery and short
 * enough that a deliberate assault is not a chore. It is the same order as the
 * blast door's measured 18.8 s breach, deliberately: both are "hold a thing
 * while the fight goes on around you" and a player who has learned one has
 * learned the other.
 */
export const TAKE_SECONDS = 12;

/**
 * How far from the centre a body counts as being on the site.
 *
 * Bigger than `MORALE.NEAR` (14 m) so a squad ordered onto a site is inside it
 * on the same order that gathers it — otherwise crewing would need a second,
 * finer order and the interface would grow a verb for no reason.
 */
export const SITE_RADIUS = 18;

/**
 * The six, and the numbers are the whole balance.
 *
 *   `crew`   bodies required. Three is a squad's worth minus its casualties,
 *            which is the size at which "I can hold two of these" stops being
 *            true for a ten-man line and starts being a choice.
 *   `every`  seconds between payouts, for the ones that pay on a clock.
 *   `hold`   what the side holding it gets, one line, in the player's words.
 *   `lose`   what the other side gets when they hold it instead.
 */
export const OBJECTIVES = Object.freeze({
  battery: Object.freeze({
    id: 'battery', name: 'The Battery', crew: 3, every: 26,
    hold: 'Artillery, off the map, on a clock you do not pay for',
    lose: 'It fires for them',
  }),
  relay: Object.freeze({
    id: 'relay', name: 'The Relay', crew: 2, every: 0,
    hold: 'Your support calls come back twice as fast',
    lose: 'They come back half as fast',
  }),
  pad: Object.freeze({
    id: 'pad', name: 'The Pad', crew: 3, every: 34,
    hold: 'A gunship pass, and you choose nothing about when',
    lose: 'Their gunship, on you',
  }),
  spire: Object.freeze({
    id: 'spire', name: 'The Spire', crew: 2, every: 0,
    hold: 'You see the whole field — their order of battle, and the true front',
    lose: 'You fight blind past the smoke',
  }),
  foundry: Object.freeze({
    id: 'foundry', name: 'The Foundry', crew: 3, every: 0,
    hold: 'Your replacements come up heavy',
    lose: 'Theirs do',
  }),
  shield: Object.freeze({
    id: 'shield', name: 'The Shield', crew: 2, every: 0,
    hold: 'One approach they cannot cross',
    lose: 'One approach you cannot use',
  }),
});

export const OBJECTIVE_IDS = Object.freeze(Object.keys(OBJECTIVES));

/* ── what a site looks like ──────────────────────────────────────────── */

/**
 * A MAST, A DISH, A RING, A SPIRE, A STACK, A PYLON.
 *
 * Built from primitives out of the shipped prop materials for the same reason
 * every other structure in this tree is: the game has no asset pipeline and a
 * silhouette a player can name at 120 m is worth more than a model nobody can
 * load. Each is a different SHAPE at the skyline — that is the whole
 * requirement, because the one thing a player must be able to do from across
 * the field is tell which of the six he is looking at.
 *
 * The `ring` under all of them is the site itself and is the same on all six:
 * it is the radius, drawn, so "am I on it" is never a guess. Its colour is the
 * only thing that changes, and it is the only per-frame write this file makes
 * to the scene.
 */
function buildSite(kind) {
  const M = propMaterials();
  const g = new THREE.Group();
  g.name = `objective:${kind}`;

  const post = (h, r, mat, y = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.25, h, 8), mat);
    m.position.y = y + h / 2;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const slab = (w, h, d, mat, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = y + h / 2;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  /* The plinth every one of them stands on, so the six read as one family of
   * installations rather than six unrelated props. */
  slab(6, 0.7, 6, M.duracrete, 0);

  if (kind === 'battery') {
    /* A long barrel on a pintle — the SPHA-T read: it is a gun and it points
     * somewhere, and the barrel is the longest straight line on the field. */
    const yoke = post(2.4, 0.9, M.darkSteel, 0.7);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 11, 8), M.steel);
    barrel.rotation.z = Math.PI / 2;
    barrel.rotation.y = 0.5;
    barrel.position.set(0, 3.4, 0);
    barrel.castShadow = true;
    g.add(barrel);
    void yoke;
  } else if (kind === 'relay') {
    post(5.5, 0.42, M.darkSteel, 0.7);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M.steel);
    dish.rotation.x = -1.05;
    dish.position.set(0, 6.4, 0);
    dish.castShadow = true;
    g.add(dish);
  } else if (kind === 'pad') {
    /* Flat and wide: the one site with nothing tall on it, because what lands
     * on it is the tall thing. */
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.5, 16), M.duracrete);
    deck.position.y = 0.9;
    deck.receiveShadow = true;
    g.add(deck);
    for (let i = 0; i < 4; i++) {
      const l = post(1.5, 0.22, M.emissive, 1.15);
      l.position.set(Math.cos(i * Math.PI / 2) * 6.2, l.position.y, Math.sin(i * Math.PI / 2) * 6.2);
    }
  } else if (kind === 'spire') {
    /* The tallest thing this file builds, and it has to be: a spire you cannot
     * see from the other end of the field is not vision, it is a prop. */
    const s = post(17, 0.85, M.stone, 0.7);
    s.geometry.dispose();
    s.geometry = new THREE.CylinderGeometry(0.35, 1.4, 17, 6);
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), M.emissive);
    eye.position.y = 18.4;
    g.add(eye);
  } else if (kind === 'foundry') {
    slab(7, 4.2, 5, M.hull, 0.7);
    const stack = post(7, 0.75, M.darkSteel, 4.9);
    stack.position.set(2.0, stack.position.y, -1.2);
    const stack2 = post(5.2, 0.6, M.darkSteel, 4.9);
    stack2.position.set(-1.6, stack2.position.y, 1.4);
  } else {
    /* shield: three pylons round an empty middle, so the thing it projects is
     * legible as a volume rather than as an object. */
    for (let i = 0; i < 3; i++) {
      const p = post(6.5, 0.5, M.darkSteel, 0.7);
      p.position.set(Math.cos(i * 2.094) * 2.6, p.position.y, Math.sin(i * 2.094) * 2.6);
      const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7), M.emissive);
      cap.position.set(p.position.x, 7.6, p.position.z);
      g.add(cap);
    }
  }

  /* THE RADIUS, DRAWN. See the note above. */
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE_RADIUS - 0.55, SITE_RADIUS, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 2;
  ring.name = 'objective:ring';
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

/** Nobody, yours, theirs — the three colours the ring is ever drawn in. */
const RING_COLOUR = { none: 0xbfb6a4, mine: 0x7fd8ff, theirs: 0xff7a5c, contested: 0xffcf5c };

/* ── one site ─────────────────────────────────────────────────────────── */

export class Objective {
  constructor(kind, position, opts = {}) {
    this.kind = kind;
    this.rec = OBJECTIVES[kind];
    this.position = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
    this.radius = opts.radius ?? SITE_RADIUS;
    /** Which side holds it: a team number, or null for nobody. */
    this.owner = opts.owner ?? null;
    /** Which side is currently over the bar and how long it has been, or null. */
    this.taking = null;
    this.takeT = 0;
    /** True while both sides are over the bar. Pays nobody. */
    this.contested = false;
    /** Seconds until the next payout, for the kinds that pay on a clock. */
    this.clock = this.rec.every || 0;
    /** Body ids standing on it this frame, by team. Read by the quorum. */
    this.crewIds = new Set();
    this.counts = new Map();
    this.group = null;
  }

  /** Everything a HUD or a check wants, in one object. */
  readout() {
    return { kind: this.kind, name: this.rec.name, owner: this.owner,
             contested: this.contested, taking: this.taking,
             progress: this.taking == null ? 0 : clamp(this.takeT / TAKE_SECONDS, 0, 1),
             crew: this.rec.crew, on: [...this.counts.entries()] };
  }
}

/* ── the field of them ────────────────────────────────────────────────── */

export class ObjectiveField {
  /**
   * @param {object} world  the World. Read for `scene`, `terrain`, `enemies`,
   *                        `players`, `command`, `support`, `stratagems`,
   *                        `contacts` and `notify` — and every one of those is
   *                        optional, because this has to be constructible in a
   *                        check fixture that has none of them.
   */
  constructor(world, opts = {}) {
    this.world = world;
    this.sites = [];
    /** Whose side the player is on, for the colour of a ring and the wording. */
    this.myTeam = opts.myTeam ?? 0;
    this._crew = new Set();
    /** Counters, so a check can price this rather than time it (HANDOFF §2.6). */
    this.takes = 0;
    this.payouts = 0;
  }

  /**
   * PUT `n` OF THEM ON THE GROUND, ALONG THE FRONT AND ACROSS IT.
   *
   * The placement rule is the design in one line: a site is worth fighting for
   * only if it is between the two armies or behind one of them, never off to
   * the side where nobody was going anyway. So they are laid along the axis the
   * two lines face down, alternating sides of it, at increasing distance from
   * the middle — which puts the first pair in the contested middle and the rest
   * progressively deeper into one side's ground.
   *
   * `pick` is a seeded roll so the same run puts the same six things in the same
   * places; a battlefield that reshuffles its objectives between reloads is a
   * battlefield you cannot learn.
   */
  place(opts = {}) {
    const { terrain } = this.world || {};
    const n = clamp(opts.count ?? 4, 0, OBJECTIVE_IDS.length);
    const pick = opts.rng || (() => 0.5);
    const axis = opts.axis ?? 0;           // radians; the direction the front faces
    const span = opts.span ?? 110;         // metres from the middle to the deepest site
    const kinds = OBJECTIVE_IDS.slice();
    /* A seeded shuffle rather than a slice, so which four of the six a run gets
     * is part of what makes one run different from another — PLAN.md §4.6 asks
     * for variance that costs no new content and this is a free one. */
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(pick() * (i + 1)) % (i + 1);
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    const fx = Math.sin(axis), fz = Math.cos(axis);
    const rx = fz, rz = -fx;
    for (let i = 0; i < n; i++) {
      const depth = (Math.floor(i / 2) + 0.5) / Math.ceil(n / 2) * span * (i % 2 ? 1 : -1);
      const across = (pick() - 0.5) * 70;
      const x = fx * depth + rx * across;
      const z = fz * depth + rz * across;
      const y = terrain?.height ? terrain.height(x, z) : 0;
      const site = new Objective(kinds[i], new THREE.Vector3(x, y, z));
      /**
       * AND IT OPENS IN SOMEBODY'S HANDS IF IT IS IN THEIR GROUND.
       *
       * A site deep behind a line belongs to that line at the start, or the
       * opening minute of every battle is both armies running past each other
       * to grab undefended installations, which is not a battle. The middle
       * pair open unowned, which is what makes them the ones worth the fight.
       */
      site.owner = Math.abs(depth) < span * 0.34 ? null : (depth > 0 ? 1 : 0);
      this.add(site);
    }
    return this.sites;
  }

  add(site) {
    this.sites.push(site);
    const scene = this.world?.scene;
    if (scene) {
      site.group = buildSite(site.kind);
      site.group.position.copy(site.position);
      scene.add(site.group);
    }
    return site;
  }

  /** Every body id currently crewing anything. Read by the quorum. */
  crewIds() { return this._crew; }

  /** The sites one side holds. */
  heldBy(team) { return this.sites.filter((s) => s.owner === team); }

  /** Does this side hold one of this kind? The question every effect asks. */
  has(kind, team) {
    for (const s of this.sites) if (s.kind === kind && s.owner === team) return true;
    return false;
  }

  /**
   * HOW FAST SUPPORT CALLS COME BACK for this side — the Relay, read by
   * `Stratagems`.
   *
   * A rate and not a subtraction, so it applies to the cooldowns already
   * running rather than only to the next one. Holding it doubles; losing it to
   * the other side halves; nobody holding it is 1, and so is a field with no
   * relay on it — which is every mode but this one.
   */
  coolRate(team) {
    if (this.has('relay', team)) return 2;
    for (const s of this.sites) if (s.kind === 'relay' && s.owner != null && s.owner !== team) return 0.5;
    return 1;
  }

  /** Does this side see the whole field? The Spire, read by `Contact`. */
  seesAll(team) { return this.has('spire', team); }

  /** Do this side's replacements come up heavy? The Foundry, read by the muster. */
  heavyReplacements(team) { return this.has('foundry', team); }

  /**
   * A CIRCLE THIS SIDE MAY NOT CROSS — the Shield, read by steering.
   *
   * Answered as a site rather than as a boolean because the caller has to know
   * WHERE, and answered per side because the whole content of the table row is
   * that the same wall is a wall for one army and a gate for the other.
   */
  wallAgainst(team) {
    for (const s of this.sites) {
      if (s.kind !== 'shield' || s.owner == null || s.owner === team) continue;
      return s;
    }
    return null;
  }

  update(dt, ctx = {}) {
    if (!(dt > 0) || !this.sites.length) return;
    const bodies = this.world?.enemies || [];
    const players = this.world?.players || [];
    this._crew.clear();

    for (const s of this.sites) {
      s.counts.clear();
      s.crewIds.clear();
      const r2 = s.radius * s.radius;
      /**
       * WHO IS STANDING ON IT — and the PLAYER is deliberately not counted.
       *
       * "A gun without a crew is scenery… the Jedi cannot crew a battery and
       * fight at once." If a Jedi standing on the plinth crewed it, the whole
       * section would collapse back into a thing one body does, and the men
       * would go back to being a health bar. He can defend it. He cannot BE it.
       */
      for (const e of bodies) {
        if (!e || e.dead || e.team == null) continue;
        const dx = e.position.x - s.position.x, dz = e.position.z - s.position.z;
        if (dx * dx + dz * dz > r2) continue;
        s.counts.set(e.team, (s.counts.get(e.team) || 0) + 1);
        s.crewIds.add(e.id);
      }
      void players;

      /* Over the bar, and by how many sides. */
      let over = null, sides = 0;
      for (const [team, n] of s.counts) {
        if (n < s.rec.crew) continue;
        sides++;
        over = team;
      }
      s.contested = sides > 1;
      const claimant = s.contested ? null : over;

      /* THE HOLD TIMER. A side already holding it does not re-take it — the
       * timer is only ever about a CHANGE of hands, so standing on your own
       * battery costs nothing and taking somebody else's costs twelve seconds
       * of keeping men there while they shoot at you. */
      if (claimant == null || claimant === s.owner) {
        s.taking = null; s.takeT = 0;
      } else {
        if (s.taking !== claimant) { s.taking = claimant; s.takeT = 0; }
        s.takeT += dt;
        if (s.takeT >= TAKE_SECONDS) {
          const was = s.owner;
          s.owner = claimant;
          s.taking = null; s.takeT = 0;
          this.takes++;
          this._announce(s, was);
        }
      }

      /* The crew of a site its own side holds are the men who are out of the
       * quorum. A body standing on a site the other side owns is assaulting it,
       * not crewing it, and is still part of its own line. */
      if (s.owner != null) {
        for (const e of bodies) {
          if (!e || e.dead || e.team !== s.owner) continue;
          if (s.crewIds.has(e.id)) this._crew.add(e.id);
        }
      }

      if (s.rec.every > 0) {
        s.clock -= dt;
        if (s.clock <= 0) {
          s.clock = s.rec.every;
          if (s.owner != null && !s.contested) { this._pay(s, ctx); this.payouts++; }
        }
      }

      if (s.group?.userData?.ring) {
        const key = s.contested ? 'contested'
          : s.owner == null ? 'none'
            : s.owner === this.myTeam ? 'mine' : 'theirs';
        s.group.userData.ring.material.color.setHex(RING_COLOUR[key]);
        s.group.userData.ring.material.opacity = s.taking != null ? 0.30 + 0.35 * (s.takeT / TAKE_SECONDS) : 0.30;
      }
    }
  }

  _announce(s, was) {
    const mine = s.owner === this.myTeam;
    const w = this.world;
    if (!w?.notify) return;
    if (mine) w.notify(`${s.rec.name.toUpperCase()} — TAKEN`, s.rec.hold);
    else if (was === this.myTeam) w.notify(`${s.rec.name.toUpperCase()} — LOST`, s.rec.lose);
    else w.notify(`${s.rec.name.toUpperCase()} — THEIRS`, s.rec.lose);
  }

  /**
   * A CLOCK PAYOUT — the Battery's shell and the Pad's pass.
   *
   * Routed through `WarSupport` rather than through a new firing path, which is
   * the same argument the whole file makes: the game already has a way to put
   * ordnance on the ground and it is the one the player uses, so a battery is
   * "support you did not have to earn" and not a second artillery system with
   * its own bugs. A site the OTHER side holds credits nothing and instead asks
   * the world to put the same weight of ordnance on the player's line, through
   * the same door the emplaced gun already uses.
   */
  _pay(s, ctx) {
    const mine = s.owner === this.myTeam;
    const w = this.world;
    if (mine) {
      w?.support?.credit?.(s.kind === 'battery' ? 26 : 20);
      w?.notify?.(`${s.rec.name.toUpperCase()}`, s.kind === 'battery'
        ? 'a fire mission, on the house' : 'a pass, inbound');
    } else {
      /* Against you. `onObjectiveFire` is the one door, so a mode that does not
       * want to be shelled simply does not install one. */
      w?.onObjectiveFire?.(s, ctx);
    }
  }

  dispose() {
    for (const s of this.sites) {
      if (!s.group) continue;
      s.group.removeFromParent();
      s.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    }
    this.sites.length = 0;
    this._crew.clear();
  }
}
