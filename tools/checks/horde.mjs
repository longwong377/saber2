/**
 * BATTLEFIELD BORZ — WHAT THE HORDE DOES, AS OPPOSED TO WHAT IT DECLARES.
 *
 * Enemy.js is 7 900 lines and nearly all of them describe a behaviour. What no
 * line of it says is how often any of them happens in a fight, and this
 * repository's signature defect (HANDOFF §2.3) is a thing that reads correctly
 * and is inert. `tools/_horde.mjs` is the census that answers "how often"; this
 * file is the set of bars that stop three specific answers going back to zero.
 *
 * Each check measures a CONSEQUENCE, not a state name — where a bolt is aimed
 * rather than which branch ran, whether the bubble is back rather than whether
 * a timer expired, whether the reaction CHANGES rather than whether a number
 * moved.
 */

import * as THREE from 'three';
import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  /* These drive real Worlds, which advance the wind clock and both seeded
   * streams — see `determinism.mjs`. */
  check = await clocked(check);

  const boot = async (settings = {}) => {
    const H = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(613);
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', quality: 'low', instantSpawn: true, ...settings },
    });
    return { world, input: H.idleInput() };
  };
  const ground = (world, x, z) => new THREE.Vector3(x, world.terrain.height(x, z), z);

  /** The band of height a body actually presents to a bolt, through its own capsules. */
  const silhouette = (e) => {
    let lo = Infinity, hi = -Infinity;
    for (const c of e.capsules()) {
      if (c.shield) continue;
      lo = Math.min(lo, c.p0.y - c.r, c.p1.y - c.r);
      hi = Math.max(hi, c.p0.y + c.r, c.p1.y + c.r);
    }
    return { lo, hi };
  };

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1 — a body on the ground is shot AT                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('horde: a body lying in the sand is aimed at where it is lying', async () => {
    /**
     * `aimAt` is the one reader every shooter in the game resolves its aim
     * through — the rifle, the committed telegraph line, the sight test, the
     * rifle pose and both turret head-tracks. `Enemy.aimPoint` answers it, and
     * while a body was LIMP it answered `chest`: `position.y + 1.15 ·
     * bodyScale`, with `position` written from the ragdoll's own centre. That
     * is a metre and a bit of empty air over a man on the floor.
     *
     * Measured through `tools/_prone.mjs`, eight B1s in a ring at 12 m on one,
     * 60 game-seconds an arm: 28.9% of bolts landed on the standing body and
     * 2.1% on the limp one — a fourteenfold collapse, in the same window
     * `Combat.OPEN_STATES` prices `downed` at ×1.5 on everything that lands.
     * A felled enemy was very nearly immune to gunfire, which is the whole of
     * FLAGSHIP §7's third verb pointing at the sky.
     *
     * THE BAR IS THE SILHOUETTE, not a number: the aim point has to be inside
     * the band of height the body's own capsules occupy. That is true of a
     * standing body on any build, and it is the thing that was false of a limp
     * one — so the check cannot be satisfied by aiming at the floor either.
     */
    const { world, input } = await boot();
    const { aimAt } = await import('../../src/game/Combat.js');
    const e = world.spawnEnemy('b1', ground(world, 0, 14));
    e.team = 0;
    for (let i = 0; i < 40; i++) { world.update(1 / 30, input); e.position.copy(ground(world, 0, 14)); }

    const at = new THREE.Vector3();
    const up = silhouette(e);
    aimAt(e, at);
    const standing = { aim: at.y, ...up };
    assert(at.y > up.lo && at.y < up.hi,
      `a STANDING body is aimed at ${at.y.toFixed(2)} against a silhouette of `
      + `${up.lo.toFixed(2)}..${up.hi.toFixed(2)} — the control arm is broken, not the subject`);

    e.actor.goRagdoll(new THREE.Vector3(0, 0, 0), null);
    for (let i = 0; i < 80; i++) { world.update(1 / 30, input); e._recoverAt = 0; e.hp = e.maxHp; }
    assert(e.actor.ragdolled, 'the body would not stay limp — nothing was measured');
    const down = silhouette(e);
    aimAt(e, at);
    assert(Number.isFinite(down.hi) && down.hi - down.lo > 0.05,
      'the limp body presents no capsules at all');
    assert(at.y < down.hi && at.y > down.lo - 0.35,
      `a LIMP body is aimed at ${at.y.toFixed(2)} against a silhouette of `
      + `${down.lo.toFixed(2)}..${down.hi.toFixed(2)} — every gun on the field lays on a point `
      + `${(at.y - down.hi).toFixed(2)} m above the highest thing it presents`);
    /* AND IT IS A SMALLER TARGET, which is the honest half: this check is not
     * asking for a prone body to be as easy to hit as a standing one. */
    assert(down.hi - down.lo < (standing.hi - standing.lo) * 0.75,
      'a body on the floor presents as tall a silhouette as one on its feet');
    return `standing aim ${standing.aim.toFixed(2)} in ${standing.lo.toFixed(2)}..${standing.hi.toFixed(2)}, `
      + `limp aim ${at.y.toFixed(2)} in ${down.lo.toFixed(2)}..${down.hi.toFixed(2)}`;
  });

  check('horde: bolts find a felled body, at matched range', async () => {
    /**
     * The consequence of the check above, through the shipped `_shoot` and the
     * shipped `_boltHitTest`: a ring of rifles on one body, once standing and
     * once limp, same range, same frames, same seed. The bar is a SHARE of the
     * standing rate rather than an absolute, because the absolute is a
     * statement about spread, aim quality and the weather all at once.
     */
    const { GUNS, RANGE, SECS } = { GUNS: 8, RANGE: 11, SECS: 14 };
    const armOf = async (prone) => {
      const { world, input } = await boot();
      const mark = world.spawnEnemy('b1', ground(world, 0, 0));
      mark.team = 0;
      /* The mark takes no consequences: `Enemy.damage` is where a bolt becomes
       * a knockback and — since `knockFlat` — a body on the floor, and a
       * standing arm felled by its third bolt is not a standing arm. */
      mark.damage = () => false;
      const guns = [];
      for (let i = 0; i < GUNS; i++) {
        const a = (i / GUNS) * Math.PI * 2;
        guns.push(world.spawnEnemy('b1', ground(world, Math.cos(a) * RANGE, Math.sin(a) * RANGE)));
      }
      const set = new Set(guns);
      /* The one harness override, and it is about WHO not about WHERE:
       * `pickTarget` only crosses armies in the three Command modes. */
      world.pickTarget = (e) => (set.has(e) ? mark : null);
      let shots = 0, hits = 0;
      const fire = world.bolts.fire.bind(world.bolts);
      world.bolts.fire = (f, d, o) => { if (set.has(o?.owner)) shots++; return fire(f, d, o); };
      const hurt = world._boltHurt.bind(world);
      world._boltHurt = (e, d, h, b) => { if (e === mark) hits++; return hurt(e, d, h, b); };
      for (let i = 0; i < 40 + SECS * 30; i++) {
        if (prone && i >= 40 && mark.actor && !mark.actor.ragdolled) {
          mark.actor.goRagdoll(new THREE.Vector3(0, 0, 0), null);
        }
        world.update(1 / 30, input);
        mark._recoverAt = 0;
        mark.position.copy(ground(world, 0, 0));
        mark.velocity.set(0, 0, 0);
        for (let k = 0; k < guns.length; k++) {
          const a = (k / GUNS) * Math.PI * 2;
          guns[k].hp = guns[k].maxHp;
          guns[k].position.copy(ground(world, Math.cos(a) * RANGE, Math.sin(a) * RANGE));
          guns[k].velocity.set(0, 0, 0);
        }
      }
      return { shots, hits, rate: shots ? hits / shots : 0 };
    };
    const up = await armOf(false);
    const down = await armOf(true);
    assert(up.shots > 30 && down.shots > 30,
      `too few shots to say anything — ${up.shots} standing, ${down.shots} limp`);
    assert(up.rate > 0.08, `the control arm landed ${(up.rate * 100).toFixed(1)}% — nothing was measured`);
    assert(down.rate > up.rate * 0.35,
      `a limp body takes ${(down.rate * 100).toFixed(1)}% of the fire aimed at it against `
      + `${(up.rate * 100).toFixed(1)}% standing — it is effectively immune to gunfire, and the `
      + '`downed` multiplier is being applied to bolts that were never going to arrive');
    return `standing ${(up.rate * 100).toFixed(1)}% of ${up.shots}, limp ${(down.rate * 100).toFixed(1)}% of ${down.shots}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2 — the droideka's generator                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('horde: a droideka that loses its bubble gets it back', async () => {
    /**
     * `dropShield`'s own comment states the rule — "A droideka's own generator
     * cycles back up; an elite's bubble does not" — and sets `deployTimer` to
     * 4.5 to say how long it takes. It also set `shieldHp = 0`, and the raise
     * in `_rangedBrain` tested `shieldHp > 0`, so the branch was unreachable
     * from the only state that leads to it: the timer ran, expired, and nothing
     * was waiting on it.
     *
     * Measured before the fix — shield dropped at t = 2 s, thirty seconds of
     * world: `deployTimer` 4.5 → 0 by t = 8 s, then twenty-two seconds with
     * `shieldUp` false and `shieldHp` 0.
     *
     * The bar is the CONSEQUENCE — the bubble is back and holding again — and
     * a ceiling on the time, because a generator that took thirty seconds
     * would satisfy "it comes back" and change nothing a player can feel.
     */
    const { world, input } = await boot();
    const d = world.spawnEnemy('droideka', ground(world, 0, 13));
    assert(d.A.shield, 'the droideka no longer declares a generator');
    let up = -1;
    for (let i = 0; i < 30 * 4; i++) { world.update(1 / 30, input); d.hp = d.maxHp; if (d.shieldUp) { up = i; break; } }
    assert(up >= 0, 'it never raised its bubble at all');
    const max0 = d.shieldMax;
    d.dropShield();
    assert(!d.shieldUp && d.shieldHp === 0, 'dropShield did not drop it');
    let back = -1;
    for (let i = 0; i < 30 * 20; i++) {
      world.update(1 / 30, input);
      d.hp = d.maxHp;
      if (d.shieldUp) { back = i / 30; break; }
    }
    assert(back >= 0,
      'twenty seconds after the bubble went down it has not come back — `dropShield` says the '
      + 'generator cycles and `deployTimer` counts the seconds, and nothing reads the result');
    assert(back < 12, `it took ${back.toFixed(1)} s to cycle, which no player will wait for`);
    assert(d.shieldHp > max0 * 0.5,
      `the bubble came back holding ${d.shieldHp.toFixed(0)} of ${max0} — a shield that stops nothing`);
    return `bubble up at ${(up / 30).toFixed(1)} s, dropped, back after ${back.toFixed(1)} s holding ${d.shieldHp.toFixed(0)}`;
  });

  check('horde: a body that cannot see does not re-ask every frame', async () => {
    /**
     * `_maybeGrenade` already carries this sentence, ten lines up, about the
     * same query and in the same method: "HE LOOKED, AND THE ANSWER WAS NO —
     * AND THAT HAS TO COST HIM THE LOOK." The rifle did not have it.
     * `attackTimer <= 0` is "ready to fire", not "asked", and nothing on the
     * refusing path moved a timer, so a body whose sight was blocked re-took a
     * physics raycast, a terrain raycast and a smoke integral EVERY FRAME for
     * as long as it stood in its band — and a level made of rooms is a level
     * where a good share of a wave is in that state at any moment.
     *
     * Measured before the fix, one B1 in band with the answer held at no:
     * 0.973 sight tests per body-frame, 29.2 a second.
     *
     * THE ANSWER IS HELD AT NO ON PURPOSE. What is being counted is how often
     * the body ASKS, which is a property of the brain; whether the terrain
     * actually blocks it is a property of the level and would make this a
     * check about the colosseum.
     */
    const { world, input } = await boot();
    const { Enemy } = await import('../../src/game/Enemy.js');
    const P = Enemy.prototype;
    const was = P._hasLineOfSight;
    let asks = 0;
    P._hasLineOfSight = function () { asks++; return false; };
    let frames = 0;
    try {
      const b = world.spawnEnemy('b1', ground(world, 0, 11));
      frames = 30 * 12;
      for (let i = 0; i < frames; i++) world.update(1 / 30, input);
      assert(!b.dead, 'the subject died before it could ask anything');
    } finally {
      P._hasLineOfSight = was;
    }
    const per = asks / frames;
    assert(asks > 0, 'a body in its own band asked for sight zero times — nothing was measured');
    assert(per < 0.5,
      `a blind body asks for line of sight ${per.toFixed(3)} times per frame (${(per * 30).toFixed(1)} a `
      + 'second) — it is re-taking two raycasts and a smoke integral on every frame it cannot see, '
      + 'which is the defect `GRENADE_LOOK` already answers ten lines up in the same method');
    return `${asks} sight tests over ${frames} frames — ${per.toFixed(3)} per body-frame, `
      + `${(per * 30).toFixed(1)} per body-second`;
  });

  check('horde: a body drawing a line on your chest is standing still to do it', async () => {
    /**
     * ── THE ONE TERM OF `aimQuality` NOTHING COULD MOVE ──────────────────
     *
     * `aimQuality` has five terms and its MOVEMENT term carries a tactical
     * instruction in its own comment: "a body running is not aiming … troops
     * that stop shoot better, and it is why HOLD and TAKE COVER are worth
     * giving." It is worth up to 1.55x of a body's own spread.
     *
     * Measured over two censuses through `tools/_horde.mjs` — 120 game-seconds
     * of Command on geonosis (4 293 body-seconds, peak 56 alive) and 60 of
     * waves — the mean of that term AT THE MOMENT OF EVERY SHOT FIRED was
     * **1.544 of a possible 1.55**, and the number of shots fired below 15% of
     * the shooter's own top speed was **zero**. It is not a term, it is a
     * constant: nothing in the brain ever chooses to stand still. The one
     * mechanism that can — `A.plant` — is declared by ONE archetype of 37.
     *
     * ── WHAT IS FIXED HERE AND WHAT IS DELIBERATELY NOT ──────────────────
     *
     * Making every shooter halt to fire would take the whole horde from 1.544
     * to ~1.0 — a third off the spread of every gun in the game — and that is
     * a balance change to every wave budget and every difficulty, not a lane's
     * to make. What IS fixed is the case where standing still is the BODY'S
     * OWN PROMISE: the four archetypes that draw a red line on your chest and
     * hold it there for most of a second. `marksman`'s own text calls that
     * line the whole of the counter-play, and a sniper that keeps strolling
     * sideways through its own telegraph is a body whose tell is drawn in the
     * HUD and contradicted by its feet.
     *
     * It is the same sentence `A.plant` makes to a siege gun and `BEAST_MOVES.
     * plant` to an animal mid-lunge, said to the one other group of bodies
     * that already advertise a wind-up. The counter-play does not move: the
     * aim is committed at the top of the telegraph (`telegraphAim`), so a
     * player who steps off the line is missed whatever the shooter's feet are
     * doing, and the extra accuracy is spent only on a player who ignored a
     * second of warning.
     */
    const { world, input } = await boot();
    const mark = world.spawnEnemy('b1', ground(world, 0, 0));
    mark.team = 0;
    mark.damage = () => false;
    const s = world.spawnEnemy('sniper', ground(world, 0, 30));
    world.pickTarget = (e) => (e === s ? mark : null);
    let charging = 0, chargeMoving = 0, fired = 0, fireMoving = 0;
    const { Enemy } = await import('../../src/game/Enemy.js');
    const P = Enemy.prototype;
    const wasShoot = P._shoot;
    P._shoot = function (...a) {
      if (this === s) { fired++; fireMoving += Math.hypot(this.velocity.x, this.velocity.z) / Math.max(1.5, this.speed || 4); }
      return wasShoot.apply(this, a);
    };
    try {
      for (let i = 0; i < 30 * 45; i++) {
        world.update(1 / 30, input);
        mark.position.copy(ground(world, 0, 0));
        mark.velocity.set(0, 0, 0);
        s.hp = s.maxHp;
        if (s.aimCharge > 0) {
          charging++;
          chargeMoving += Math.hypot(s.velocity.x, s.velocity.z) / Math.max(1.5, s.speed || 4);
        }
      }
    } finally { P._shoot = wasShoot; }
    assert(charging > 40 && fired > 3,
      `the sniper telegraphed on ${charging} frames and fired ${fired} times — nothing was measured`);
    const pace = chargeMoving / charging;
    assert(pace < 0.35,
      `it travels at ${(pace * 100).toFixed(0)}% of its own top speed while its laser is on your `
      + 'chest — the tell says "it has stopped to take this shot" and the feet say otherwise, and '
      + `aimQuality's MOVEMENT term is worth ${(1 + Math.min(pace, 1.4) * 0.55).toFixed(2)}x of its spread for it`);
    return `${charging} telegraph frames at ${(pace * 100).toFixed(0)}% of top speed, `
      + `${fired} shots at ${((fireMoving / fired) * 100).toFixed(0)}%`;
  });

  check('horde: a leader rallies its own side and not the men shooting at it', async () => {
    /**
     * `_updateElite`'s leader loop had no team test. In waves and roguelite
     * that is right by accident — `ctx.enemies` holds one side and the player
     * is not in it — but Command, skirmish and campaign put BOTH armies in
     * that array, which is the fact `World.pickTarget` and `_hostilesFor` are
     * built on. So a Confederate leader standing inside `RALLY.radius` of the
     * Republic line handed those clone troopers a 22% quicker reload, 15% more
     * pace, 25% more damage and a faster duel tempo. Nine and a half metres is
     * what a front is.
     *
     * It also broke the one promise the code's own note makes to the player:
     * the ring drawn on the ground "is the set of bodies getting the buff",
     * and half of them were the ones shooting at it.
     */
    const { world, input } = await boot();
    const { applyModifier, RALLY } = await import('../../src/game/Enemy.js');
    const boss = world.spawnEnemy('b2', ground(world, 0, 15));
    assert(applyModifier(boss, 'leader'), 'the leader modifier would not install');
    const mate = world.spawnEnemy('b1', ground(world, 2, 15));
    const foe = world.spawnEnemy('trooper', ground(world, -2, 15));
    foe.team = 0;
    for (let i = 0; i < 6; i++) world.update(1 / 30, input);
    const dm = mate.position.distanceTo(boss.position);
    const df = foe.position.distanceTo(boss.position);
    assert(dm < RALLY.radius && df < RALLY.radius,
      `both bodies must stand inside the ring — mate ${dm.toFixed(2)} m, foe ${df.toFixed(2)} m `
      + `against ${RALLY.radius}`);
    assert(mate.rallyTimer > 0,
      'the leader did not rally its own side at all — the aura is off, not mis-aimed');
    assert(!(foe.rallyTimer > 0),
      `a leader on the other side rallied a body on team ${foe.team} standing ${df.toFixed(2)} m `
      + 'away — it is making the army that is shooting at it reload quicker, move faster and hit '
      + 'harder, and the ring on the ground says it is helping them');
    return `mate at ${dm.toFixed(2)} m rallied ${mate.rallyTimer}, foe at ${df.toFixed(2)} m `
      + `rallied ${foe.rallyTimer || 0} (ring ${RALLY.radius} m)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3 — nerve reaches the one place it decides an ACT                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('horde: a droid that has watched its rank die is not as brave as a fresh one', async () => {
    /**
     * `Reactions.js`'s header says the choice between diving, throwing one back
     * and lying on it is "made out of state this game already keeps rather than
     * out of a die roll … how much NERVE the man has". For a body with a
     * `Trooper` record that was true. For the horde — every body in waves,
     * roguelite, campaign and skirmish — it read `(threat - 1) / 6`: a
     * per-archetype constant fixed at spawn, so a droid that had watched half
     * its rank cut down in front of it was exactly as willing to lie on a
     * grenade as one that had just walked in.
     *
     * `Enemy.nerve` is a real number that real things move (`nerveTick` for a
     * lit blade in the rank, `witnessDeath` for every body that falls inside
     * `SEE`) and it was already read by `_think`'s break clause and by
     * `nerveAim`. The one place in the game where nerve decides an ACT rather
     * than a wobble was the reader that did not have it.
     *
     * The bar is a CHANGE OF ANSWER, not a change of number: the same body, the
     * same grenade, the same distance — full nerve reaches for it, broken nerve
     * gets out of the way.
     */
    const { world, input } = await boot();
    const R = await import('../../src/game/Reactions.js');
    const { NERVE } = await import('../../src/game/Nerve.js');

    /* An ARC trooper: `threat` 6, so `braveryOf` reads 0.833 at full nerve —
     * over `NERVE.throwBack` (0.42) and over `NERVE.smother` (0.78). It is the
     * body with the most to lose from a constant. */
    const man = world.spawnEnemy('arc', ground(world, 0, 12));
    const mates = [];
    for (let i = 0; i < 3; i++) mates.push(world.spawnEnemy('arc', ground(world, 1.2 * (i + 1), 12)));
    for (const m of mates) m.team = man.team;
    for (let i = 0; i < 30; i++) world.update(1 / 30, input);

    man.nerve = NERVE.START;
    const fresh = R.braveryOf(man);
    man.nerve = 0.25;
    const shaken = R.braveryOf(man);
    assert(fresh > shaken + 0.1,
      `a body at full nerve reads ${fresh.toFixed(3)} and the same body broken reads `
      + `${shaken.toFixed(3)} — the chooser is not reading the ledger at all`);
    assert(Math.abs(fresh - 0.8333) < 0.02,
      `at full nerve an ARC reads ${fresh.toFixed(3)} and its archetype temper is 0.833 — this `
      + 'was meant to be the identity, so nothing in the shipped game moves until the player acts');

    /* AND THE ANSWER CHANGES. A live grenade at his feet with mates around it. */
    const at = man.position.clone();
    const from = at.clone(); from.y += 10; from.x += 6;
    const kindAt = (nerve) => {
      man.nerve = nerve;
      man.reaction = null;
      const g = world.grenades.throw(from, at, { team: man.team });
      /* Land it: `chooseReaction` refuses to decide while it is still in the
       * air, which is its own note's whole point. */
      for (let i = 0; i < 60 && !g.grounded; i++) world.grenades.update(1 / 30, world._frameCtx ?? world);
      const r = R.chooseReaction(man, g, { enemies: world.enemies });
      g.dead = true;
      return r?.kind ?? null;
    };
    const brave = kindAt(NERVE.START);
    const broken = kindAt(0.2);
    assert(brave === 'smother' || brave === 'throwback',
      `a full-nerve ARC standing on a live grenade with three mates around it chose '${brave}'`);
    assert(broken === 'dive',
      `the same body with its nerve gone still chose '${broken}' — nerve decides nothing here`);
    return `arc: ${fresh.toFixed(3)} fresh → ${shaken.toFixed(3)} shaken; on the grenade ${brave} → ${broken}`;
  });

  check('horde: a frightened droid is slower off the mark than a steady one', async () => {
    /**
     * `LAG.shaken` is the slowest of the three reaction times and its own note
     * says what it is for: "a frightened man freezes first". `senseDanger`
     * chose between them on `(body.trooper?.morale ?? 1) < 0.4` — a flat 1 for
     * every body in the horde — so the term could only ever be paid by a named
     * trooper in Command, and every droid in the game answered a grenade at a
     * steady soldier's pace whatever had just happened to it.
     *
     * `_lag` is stamped by `senseDanger` on the frame a body first sees a given
     * grenade, so the two arms are read off the shipped writer rather than
     * recomputed here.
     */
    const { world, input } = await boot();
    const R = await import('../../src/game/Reactions.js');
    /* ONE BODY FOR BOTH ARMS. `_lag` is the chosen base PLUS `jitterOf(body) *
     * LAG.jitter`, and the jitter spans 0.18 against the 0.08 between the two
     * bases — so two different bodies cannot be compared at all, and a check
     * that used two would read whichever way their hashes fell. Same body,
     * same jitter, and the only thing that moves is the ledger. */
    const b = world.spawnEnemy('b1', ground(world, 20, 20));
    for (let i = 0; i < 10; i++) world.update(1 / 30, input);
    const lagOf = (nerve) => {
      b.nerve = nerve;
      b._sawG = null;
      b.reaction = null;
      const at = b.position.clone();
      const from = at.clone(); from.y += 10;
      const g = world.grenades.throw(from, at, { team: 3 });
      R.senseDanger(b, 1 / 30, { enemies: world.enemies, time: world.time });
      const lag = b._lag;
      g.dead = true;
      return lag;
    };
    const steady = lagOf(1);
    const frightened = lagOf(0.2);
    assert(Number.isFinite(steady) && Number.isFinite(frightened), 'senseDanger stamped no reaction time');
    assert(frightened > steady + 0.05,
      `a droid at full nerve takes ${steady.toFixed(3)} s to move and one whose nerve has gone takes `
      + `${frightened.toFixed(3)} s — LAG.shaken (${R.LAG.shaken}) is unreachable by anything without a record`);
    return `steady ${steady.toFixed(3)} s, frightened ${frightened.toFixed(3)} s `
      + `(base ${R.LAG.base}, shaken ${R.LAG.shaken})`;
  });
}
