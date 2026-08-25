/**
 * BATTLEFRONT BORZ — a flag an author sets has to mean something.
 *
 * Two defects, both found by auditing the player's own feature requests rather
 * than by anything failing, and both the signature bug of this codebase: code
 * that reads correctly and is silently inert.
 *
 *   `Prop.grippable` was WRITTEN AND NEVER READ. Props.js sets it false on
 *   exactly two things — the pillar and the spire — and Destruction's proxy for
 *   every destructible structure in the level sets it false too. Not one line
 *   in src/ or tools/ ever looked at it. The only real gate was mass, so at a
 *   high Force Power slider the 900 kg pillar the author had explicitly
 *   excluded came out of the ground anyway.
 *
 *   `lastGripRefusal` recorded the mass and the cap when a lift was refused,
 *   and nothing ever read those either. A refused lift was a groan and a
 *   shudder with no explanation, which reads as the Force being broken rather
 *   than as the thing being too heavy.
 *
 * The last check here is the general form, and it is the one worth keeping: a
 * field that only ever appears on the left of an assignment is not a feature.
 *
 * ── AND THEN A THIRD, WHICH IS THE SAME DEFECT WEARING A CONTEST ─────────
 *
 * `liftTarget` was ONE SLOT. Two Force users could both hold one body — both
 * `gripEnemy` true, both bars draining — and the body went wherever whichever
 * of them ran later that frame put it. Measured on a live host/client pair
 * before the fix: the body sat 0.30 m from one hold point and 5.43 m from the
 * other, with nothing on either screen to say which of the two people paying
 * for it was getting nothing. State written by two, read as though written by
 * one. The last four checks in this file drive the contest that replaced it,
 * and every number they expect is derived from `RESIST_CAP` and `RESIST_BEATEN`
 * rather than typed — because the whole claim is that the tug-of-war is the
 * arithmetic the game already had.
 */
import { readFile, readdir } from 'node:fs/promises';
import * as THREE from 'three';
import { Player } from '../../src/game/Player.js';
import { RESIST_CAP, RESIST_BEATEN, RESIST_PER_FORCE, gripHolders, heldMass } from '../../src/game/Enemy.js';
import { GRAB_BREAK } from '../../src/game/Reactions.js';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld, Body as RBody, LAYER, box as boxShape } from '../../src/physics/RapierWorld.js';
import { BoltPool } from '../../src/game/Bolts.js';
import { lines } from './_source.mjs';
import { clocked } from './_shared.mjs';

/**
 * ── WHAT THE CONTEST'S NUMBERS ARE, READ OFF THE TWO CONSTANTS ───────────
 *
 * A gripper keeps the part of his pull the other one cannot cancel, and
 * `forceResistance` caps a cancellation at `RESIST_CAP` — or at
 * `RESIST_CAP × RESIST_BEATEN` once that guard is broken. So:
 *
 *   both guarded    each keeps 1 − 0.55 = 0.450 → shares 0.500 / 0.500
 *   his guard gone  the winner keeps 1 − 0.55×0.35 = 0.8075, the loser 0.450
 *                   → shares 0.642 / 0.358, a pull ratio of 1.79
 *
 * Nothing below spells 0.5, 0.642 or 1.79. If either constant is retuned these
 * expectations move with it, which is the only way a check can be a statement
 * about the design rather than a transcription of one afternoon's numbers.
 */
const KEPT = 1 - RESIST_CAP;                       // …of his own pull, guarded
const KEPT_BEATEN = 1 - RESIST_CAP * RESIST_BEATEN;  // …against a broken guard
const SHARE_LEVEL = KEPT / (KEPT + KEPT);
const SHARE_WON = KEPT_BEATEN / (KEPT_BEATEN + KEPT);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/* Scratch for the grab fixture's aim, and the clamp `Math.asin` needs on a
 * component that floating point can push a hair past 1. */
const _gv = new THREE.Vector3();
const clamp01 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {},
});

/**
 * TWO REAL PLAYERS, ONE REAL CRATE, ONE REAL RapierWorld.
 *
 * Two players and not a host/client pair, because what is under test here is
 * the ARITHMETIC and a wire would only put latency between it and the
 * assertion — `coop.mjs` drives the same contest across two machines and is
 * where the wire's half belongs. Both hands are driven through the shipped
 * `_updateGrip` rather than through `gripClaim` directly, so the check fails if
 * the contest is correct and nobody calls it, which is this suite's whole
 * subject.
 *
 * The two hold points are 16 m apart on the x axis with the crate between them,
 * so the resolution's SIGN says who is winning and its magnitude says by how
 * much — a fixture where both wanted the same place could not tell a working
 * contest from a broken one.
 */
async function bench({ forcePower = 1 } = {}) {
  await initPhysics();
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  const scene = new THREE.Scene();
  const w = {
    scene, physics, terrain: physics.terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower, forceDrain: 1 },
    difficulty: null, hpScale: 1, dmgScale: 1,
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: new BoltPool(scene, 32), time: 0, combatIntensity: 0,
    groundColor: 0, severs: 0, notices: [],
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {},
      camera: new THREE.PerspectiveCamera(60, 1, 0.045, 1000) },
    report() {}, notify(t, d) { this.notices.push(`${t} — ${d}`); }, notifyFloating() {},
    addHitstop() {}, onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {},
    onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {}, onPlayerDeath() {}, setTimeScale() {},
  };
  const AT = 6;                      // where each of them is trying to put it
  const mk = (x) => {
    const p = new Player(w, { isLocal: true });
    p.position.set(x, 0, 0);
    p.camera.pos.set(x, 1.6, 0);
    p.force = p.maxForce;
    w.players.push(p);
    p._wants = V(Math.sign(x) * 8, 1.4, -AT);
    return p;
  };
  const a = mk(-5), b = mk(5);
  const crate = new RBody({ position: V(0, 1.4, -AT), shape: boxShape(0.4, 0.5, 0.4),
    mass: 22, layer: LAYER.PROP, mask: LAYER.WORLD });
  physics.add(crate);
  const ctx = { input: null, terrain: w.terrain, physics, particles: null, bolts: w.bolts,
    camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies, players: w.players,
    pickTarget: () => a };
  /* Taken by hand rather than through `toggleGrip`: the pick casts a ray at a
   * crosshair and this fixture is about what happens AFTER two people have hold
   * of the same thing. `gripDistance` is set to the real reach to the crate so
   * `_updateGrip`'s distance clamp is a no-op rather than a hidden variable. */
  const take = (p) => {
    p.gripBody = crate;
    crate.gravityScale = 0;
    p.gripDistance = p.camera.pos.distanceTo(p._wants);
  };
  const hands = [];
  /**
   * `settle` SECONDS OF NOT LOOKING, and it is the difference between a
   * measurement and a transient. The hold is a P controller: a crate that has
   * just changed hands is still TRAVELLING towards the new resolution, and the
   * standard deviation of a body crossing the arena is not its tremor. Measured
   * without it, an uncontested hold "trembled" by 0.036 m — every metre of
   * which was the crate still arriving.
   */
  const drive = (secs, { beaten = null, settle = 0 } = {}) => {
    const dt = 1 / 60;
    const path = [];
    const step = () => {
      w.time += dt; ctx.time = w.time;
      for (const p of hands) {
        p.aimDir.copy(p._wants).sub(p.camera.pos).normalize();
        if (beaten) p.staggerTimer = p === beaten ? 1 : 0;
      }
      for (const p of hands) p._updateGrip(dt, ctx);
      physics.step(dt);
    };
    for (let i = 0; i < settle * 60; i++) step();
    const f0 = hands.map((p) => p.force);
    for (let i = 0; i < secs * 60; i++) { step(); path.push(crate.position.x); }
    const mean = path.reduce((x, c) => x + c, 0) / path.length;
    const sd = Math.sqrt(path.reduce((x, c) => x + (c - mean) ** 2, 0) / path.length);
    return { x: mean, wobble: sd, spent: hands.map((p, i) => f0[i] - p.force) };
  };
  return { w, ctx, crate, a, b, hands, take, drive, dispose: () => w.bolts.dispose() };
}


/** Every .js under src/, as [relative path, text]. */
async function sources() {
  const root = new URL('../../src/', import.meta.url);
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(u, prefix + e.name + '/');
      else if (e.name.endsWith('.js')) out.push([prefix + e.name, await readFile(u, 'utf8')]);
    }
  };
  await walk(root, '');
  return out;
}

/** A body of the shape the physics layer hands the grip picker. */
function body(opts = {}) {
  return {
    invMass: opts.invMass ?? 1 / 40,
    layer: opts.layer ?? LAYER.PROP,
    dead: false,
    userData: opts.prop ? { prop: opts.prop } : {},
  };
}

export async function run({ check, assert }) {
  /* This file builds enemies, so it draws from the shared rng stream; take the
   * pair for the whole file rather than seeding each body by hand. */
  check = await clocked(check);
  check('grip: a prop an author marked ungrippable cannot be gripped', () => {
    const me = { body: {} };
    const g = (b) => Player.prototype._grippableBody.call(me, b);

    assert(g(body({ prop: { grippable: true } })), 'an ordinary prop is not grippable');
    assert(g(body({ prop: {} })), 'a prop that never mentions grippable is not grippable');
    assert(g(body()), 'a loose body with no prop behind it is not grippable');
    assert(!g(body({ prop: { grippable: false } })),
      'a prop marked grippable:false was still grippable — the flag is inert again');

    // The flag must not become a way to grip something that is otherwise
    // ineligible, and it must not override the mass/layer gates either way.
    assert(!g(body({ invMass: 0, prop: { grippable: true } })),
      'a static body became grippable because a prop said so');
    return 'true / true / true / FALSE for grippable:false; a static stays static';
  });

  check('grip: a refused lift says why, with the numbers', async () => {
    // The refusal has to carry the mass, the cap AND name the control that
    // moves the cap. A number with no lever attached is just a wall.
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    // The REFUSAL SITE, not the first mention — the constructor initialises the
    // field, and a window measured from there reaches nothing.
    assert(src.includes('lastGripRefusal = {'), 'the refusal no longer records the mass and the cap');
    // The refusal and the notify that follows it: a neighbourhood, counted in
    // lines, so a comment added above the notify does not push it out of range.
    const near = lines(src, 'lastGripRefusal = {', 12);
    assert(/notify/.test(near), 'a refused lift still tells the player nothing');
    assert(/mass/.test(near) && /cap/.test(near),
      'the refusal message does not carry both the mass and the cap');
    assert(/Force Power/i.test(near),
      'the refusal does not name the setting that raises the cap, so the number is a dead end');
    return 'the refusal notifies with mass, cap and the name of the slider that moves it';
  });

  check('grip: no field is written everywhere and read nowhere', async () => {
    // THE GENERAL FORM, and the reason this suite exists. `grippable` was set in
    // two files and read in none. A field that only ever appears on the left of
    // an assignment is not a feature, it is a comment with syntax.
    //
    // Scoped to fields an AUTHOR sets to describe a thing — the ones where being
    // inert is silent — rather than every property in the codebase, because the
    // broad sweep is all false positives and a check nobody trusts gets deleted.
    const files = await sources();
    /* `grabLoad` and `holdStrength` are §4.8's second bullet's two new fields and
     * they are on this list for the reason the list exists: both are written by
     * one file and read by another, which is exactly the shape that goes inert
     * without anybody noticing. */
    const WATCH = ['grippable', 'lastGripRefusal', 'invincible', 'explosive', 'grabLoad', 'holdStrength'];
    const rows = [];
    for (const field of WATCH) {
      let writes = 0, reads = 0;
      for (const [, text] of files) {
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        writes += (code.match(new RegExp(`\\.${field}\\s*=[^=]`, 'g')) || []).length;
        writes += (code.match(new RegExp(`(^|[{,\\s])${field}\\s*:`, 'gm')) || []).length;
        // A read is the name used anywhere it is NOT the target of an assignment.
        for (const m of code.matchAll(new RegExp(`\\b${field}\\b`, 'g'))) {
          const after = code.slice(m.index + field.length, m.index + field.length + 4);
          if (!/^\s*[:=][^=]/.test(after)) reads++;
        }
      }
      rows.push(`${field} ${writes}w/${reads}r`);
      // A field that does not exist is fine; a field that is WRITTEN and never
      // read is the bug. Deleting it is as valid a fix as giving it a reader.
      assert(writes === 0 || reads > 0,
        `${field} is written ${writes} times and read nowhere — it does nothing`);
    }
    return rows.join(', ');
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE OPEN WINDOW — FLAGSHIP §7's third verb, and what bounds it
   * ──────────────────────────────────────────────────────────────────── */

  await check('grip: a shove hard enough to leave its feet leaves it on the ground, and a body on the ground is open', async () => {
    /**
     * ── THE DEFECT, WHICH WAS A COMMENT THAT NOTHING IMPLEMENTED ──────────
     *
     * `Enemy.applyKnockback` carried `// hit hard enough to leave its feet`
     * over `this.stun(1.2, impulse, 1.4)`. A stun is a body STANDING STILL —
     * so an eleven-metre Force wave at impulse 34 threw a dozen droids and
     * every one of them landed upright, froze for 1.2 s and walked on. This
     * suite's own opening paragraph names that shape: code that reads
     * correctly and is silently inert.
     *
     * ── WHY IT IS THE THING THAT BOUNDED §7's THIRD VERB ─────────────────
     *
     * "OPEN — the Force is a multiplier on other people's guns." `openness()`
     * pays it, and measured on a real Command battle with a Jedi gripping
     * continuously it reached 0.5-1.2% of enemy body-seconds. The bar was
     * already fully committed — 503 Force spent in 82 game-seconds against an
     * income of 7.5/s — so the answer was never "spend more"; it was that a
     * point of Force bought 0.05 open body-seconds. The grip is one body at a
     * time and the choke kills it in four and a half seconds.
     *
     * A shove is three to eight bodies for one press, and a body on the floor
     * is limp for its flight plus `GET_UP` plus `recover`'s beat — about three
     * times a stun. Same Force, same button, an order of magnitude more of the
     * thing §7 is about.
     *
     * ── WHAT THIS CHECK BINDS, ON A REAL WORLD ───────────────────────────
     *
     * Three facts, because any one of them alone is inert:
     *
     *   1. the shove puts the body down (`knockFlat`),
     *   2. a body that is down is OPEN — `openness()` above 1 for the whole
     *      window and not merely for the 1.2 s stun inside it,
     *   3. and that opening is paid to SOMEBODY ELSE'S GUN, through the
     *      shipped `World._boltHitTest` rather than through a second copy of
     *      the damage rule.
     *
     * `World.js` and `Combat.js` are imported INSIDE the body — HANDOFF §2.1:
     * a static edge from a check to the engine graph links before the loader
     * hook is in, and patches the wrong copy of three.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { openness } = await import('../../src/game/Combat.js');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const input = H.idleInput();
    const step = () => world.update(1 / 60, input);
    for (let i = 0; i < 10; i++) step();

    /* TWO BODIES AND ONE BOLT EACH, for the reason `force.mjs` gives at the
     * same fixture: this bolt is worth more than a B1's whole health, so a
     * body shot twice is a corpse the second time and `openState` answers
     * null for a corpse. */
    const shoot = (e) => {
      const before = e.hp;
      /**
       * THROUGH THE BODY'S OWN CAPSULE, not through `position + 0.9`.
       *
       * A felled body is lying down, and a bolt aimed at where a standing
       * chest would be goes over it — measured, 0.00 hp, which would have made
       * this check report the multiplier as broken when what had moved was the
       * target. That is a real finding about the verb and it is recorded in
       * NEXT.md as one; it is not what this check is for. Both arms are shot
       * through the fattest capsule the body actually presents, so the only
       * thing that differs between them is the open state.
       */
      const caps = e.capsules().filter((c) => !c.shield);
      const fat = caps.reduce((a, c) => (c.r > a.r ? c : a), caps[0]);
      const mid = fat.p0.clone().lerp(fat.p1, 0.5);
      world._boltHitTest({ damage: 6, owner: null, team: 0, color: { getHex: () => 0 } },
        mid.clone().add(new THREE.Vector3(0, 0, -6)), mid.clone().add(new THREE.Vector3(0, 0, 6)));
      return before - e.hp;
    };

    const a = world.spawnEnemy('b1', new THREE.Vector3(0, 0, -8));
    const b = world.spawnEnemy('b1', new THREE.Vector3(4, 0, -8));
    assert(a && b, 'setup: two droids did not spawn');
    for (let i = 0; i < 6; i++) step();

    /* THE REFERENCE IS TAKEN BEFORE THE SHOT AND NOT AFTER IT. A bolt landing
     * on a droid can stagger it, so `openness(a)` a frame later is a fact
     * about the bolt rather than about the body it is the control for. */
    assert(openness(a) === 1 && openness(b) === 1,
      'a droid standing on its own two feet already reports an opening');
    const standing = shoot(a);
    assert(standing > 0, 'the bolt missed a standing droid — the instrument is wrong, not the game');

    /* THE SHOVE ITSELF, through the one door every Force power comes through.
     * Impulse 26 is `forcePush`'s own, so this is the shipped blow rather than
     * a number chosen to pass. */
    b.applyKnockback(new THREE.Vector3(0, 0.6, 1).normalize().multiplyScalar(26), 0, null, false);
    /**
     * ONE STEP, BECAUSE THE FALL IS TAKEN IN `_move` AND NOT INSIDE THE BLOW.
     *
     * `knockFlat` records the fall and `_takeFall` takes it on the body's next
     * step — deliberately, and the note over it says why: going limp inside
     * `applyKnockback` put nineteen fresh dynamic bodies into `world.physics`
     * in the middle of the sweep that felled the body, and `forcePush` then
     * shoved every one of them again as loose furniture. It is the same frame
     * in play (players step before enemies), so this is one `update`, not a
     * delay a player could see.
     */
    step();
    assert(!!b.actor?.ragdolled,
      'a droid shoved at impulse 26 is still on its feet — the comment says it leaves them');
    const flatOpen = openness(b);
    assert(flatOpen > 1, `a droid on the ground reports openness ${flatOpen.toFixed(2)}x`);

    /* AND THE LINE'S GUNS ARE PAID IT. Same bolt, same body plan, one
     * standing and one down. */
    const down = shoot(b);
    assert(Math.abs(down / standing - flatOpen) < 0.3,
      `a shoved droid took ${(down / standing).toFixed(2)}x the bolt a standing one took, against `
      + `the ${flatOpen.toFixed(2)}x its open state is worth`);

    /**
     * ── THE WINDOW IS LONGER THAN THE STUN, WHICH IS THE WHOLE POINT ─────
     *
     * `applyKnockback` stuns for 1.2 s. If the opening ended there this change
     * would be worth nothing: what buys the extra is the body lying still for
     * `GET_UP` and then paying `recover`'s beat on top. So the window is
     * measured rather than asserted from the constants — stepped until
     * `openness` comes back to 1 — and it has to outlast the stun by enough to
     * be the reason anybody pressed the button.
     */
    let open = 0;
    for (let i = 0; i < 60 * 12 && openness(b) > 1; i++) { step(); open += 1 / 60; }
    assert(open > 1.2 * 1.6,
      `a shoved droid is open for ${open.toFixed(2)} s against the 1.20 s its stun alone would buy`);
    assert(open < 11,
      `a shoved droid is open for ${open.toFixed(2)} s — it never got up, which is a floor and not a window`);
    assert(!b.dead && !b.actor?.ragdolled,
      'the shoved droid never came back off the floor');

    /**
     * ── AND A SHOVE FROM YOUR OWN SIDE DOES NOT FELL YOU ─────────────────
     *
     * `Player._shockwave` iterates `ctx.enemies` with no team test — a Force
     * wave is physics and does not aim — and in Command your own line stands
     * in `world.enemies`. Without the clause this asserts, a panic button
     * pressed every few seconds would put your own rank on the floor for five
     * seconds at a time, which is the mode's whole objective inverted. The
     * 1.2 s stun still reaches them; only the knockdown is filtered.
     */
    assert(a.team === b.team, 'setup: the two droids are not on the same side');
    const c = world.spawnEnemy('b1', new THREE.Vector3(-4, 0, -8));
    assert(c, 'setup: the third droid did not spawn');
    for (let i = 0; i < 6; i++) step();
    c.applyKnockback(new THREE.Vector3(0, 0.6, 1).normalize().multiplyScalar(26), 0, a, false);
    step();
    assert(!c.actor?.ragdolled,
      'a shove from a body on its own side put it on the floor — every Force wave would fell your line');
    assert(c.stunTimer > 0, 'a shove from its own side stopped reaching it at all');

    world.unload();
    return `standing ${standing.toFixed(1)} hp, down ${down.toFixed(1)} hp — `
      + `${(down / standing).toFixed(2)}x against a stated ${flatOpen.toFixed(2)}x, `
      + `open for ${open.toFixed(2)} s against a 1.20 s stun`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * CONTESTED TELEKINESIS — PLAN §4.8, and it is `forceResistance` twice
   * ──────────────────────────────────────────────────────────────────── */

  await check('grip: two hands on one body land it between them, and breaking his guard moves where between', async () => {
    /**
     * THE CONTROL FIRST, because "the object sits between them" is only worth
     * anything against a hold that does NOT sit between anything: one hand puts
     * the crate exactly where that hand asked, with no tremor, no contest tax
     * and `share` 1. Every grip in a single-player game is that arm, and it has
     * to be bit-for-bit the hold that shipped.
     */
    const B = await bench();
    B.hands.push(B.a); B.take(B.a);
    const alone = B.drive(1.5, { settle: 1.5 });
    assert(Math.abs(alone.x - B.a._wants.x) < 0.6,
      `one hand put the crate at x ${alone.x.toFixed(2)}, not at the ${B.a._wants.x.toFixed(2)} it asked for`);
    assert(alone.wobble < 0.005, `an uncontested hold trembles by ${alone.wobble.toFixed(4)} m — it should not tremble at all`);
    assert(B.a.gripShare === 1 && alone.spent[0] > 0,
      `an uncontested hold reports share ${B.a.gripShare} and spent ${alone.spent[0].toFixed(2)}`);

    /**
     * NOW THE SECOND HAND. Both guarded, so each cancels `RESIST_CAP` of the
     * other and the shares are level BY CONSTRUCTION rather than by tuning —
     * which is why the deadlock is the interesting state and not a stalemate
     * bug. The crate goes to the midpoint of two points 16 m apart, both bars
     * drain, and it shudders.
     */
    B.hands.push(B.b); B.take(B.b);
    const level = B.drive(1.5, { settle: 1.5 });
    const levelShare = [B.a.gripShare, B.b.gripShare];
    const mid = (B.a._wants.x + B.b._wants.x) / 2;
    assert(gripHolders(B.crate, B.w.time) === 2, 'the ledger does not have two hands on the crate');
    assert(Math.abs(B.a.gripShare - SHARE_LEVEL) < 1e-6 && Math.abs(B.b.gripShare - SHARE_LEVEL) < 1e-6,
      `two guarded hands report ${B.a.gripShare.toFixed(3)}/${B.b.gripShare.toFixed(3)}, not `
      + `${SHARE_LEVEL.toFixed(3)} each — the deadlock is not the one RESIST_CAP describes`);
    assert(Math.abs(level.x - mid) < 0.3,
      `the contested crate sits at x ${level.x.toFixed(2)} rather than the ${mid.toFixed(2)} midpoint — `
      + 'one hand still owns it outright');
    assert(level.spent[0] > 0 && level.spent[1] > 0,
      `only one of them is paying: ${level.spent.map((f) => f.toFixed(1)).join(' / ')} Force over 1.5 s`);
    assert(level.wobble > alone.wobble * 8,
      `a contested crate wobbles ${level.wobble.toFixed(3)} m against an uncontested ${alone.wobble.toFixed(4)} — `
      + 'the shudder is not there');

    /**
     * AND THE DECISION. Nothing about the two hands changes except that ONE
     * GUARD IS BROKEN — the same `staggerTimer` a shove or a blade already sets,
     * read through the same `_guardOpen` the player's own `resistForce` reads —
     * and the object moves several metres towards the man who broke it. If this
     * assertion could pass with the guard intact the contest would be a delay
     * rather than a decision, so it is written as a MOVE and not as a state.
     *
     * BOTH BARS BACK TO FULL FIRST, so the only thing that differs between the
     * two measurements is the guard. `forceResistance` has a SECOND lever — a
     * pool under `pull × RESIST_CAP / RESIST_PER_FORCE` cannot buy a full
     * cancellation any more — and after six seconds of tug-of-war both of these
     * bars are down near it. Measured without the refill the winner's share
     * read 0.628 rather than 0.642, and the 0.014 was his OWN bar running low.
     * That lever is real and has a check of its own below; mixing the two here
     * would mean neither was being measured.
     */
    B.a.force = B.a.maxForce; B.b.force = B.b.maxForce;
    const won = B.drive(1.5, { beaten: B.b, settle: 1.5 });
    const floor = B.a._gripPull(B.crate.mass, false) * RESIST_CAP / RESIST_PER_FORCE;
    assert(B.a.force > floor && B.b.force > floor,
      `a bar fell to the saturation floor mid-measurement (${B.a.force.toFixed(1)}/${B.b.force.toFixed(1)} `
      + `against ${floor.toFixed(2)}) — this check would then be measuring the pool and not the guard`);
    assert(Math.abs(B.a.gripShare - SHARE_WON) < 1e-6,
      `against a broken guard the winner holds ${B.a.gripShare.toFixed(3)}, not ${SHARE_WON.toFixed(3)}`);
    const moved = level.x - won.x;
    assert(moved > 2, `breaking his guard moved the crate ${moved.toFixed(2)} m — it barely noticed`);
    assert(Math.sign(won.x - mid) === Math.sign(B.a._wants.x - mid),
      `the crate went the wrong way: ${won.x.toFixed(2)} with the winner at ${B.a._wants.x.toFixed(2)}`);
    /* THE TREMOR REPORTS THE CONTEST. It is scaled by how evenly matched the
     * two are, so a fight one man is winning shakes LESS — a shudder that
     * looked the same either way would be decoration. */
    assert(won.wobble < level.wobble * 0.8,
      `the shudder is ${won.wobble.toFixed(3)} m while one side is winning against ${level.wobble.toFixed(3)} `
      + 'while they are level — it does not report the contest');

    B.dispose();
    return `alone x ${alone.x.toFixed(2)} (wobble ${alone.wobble.toFixed(4)}); level `
      + `${levelShare.map((v) => v.toFixed(3)).join('/')} at x ${level.x.toFixed(2)} `
      + `wobble ${level.wobble.toFixed(3)}, both paying ${level.spent.map((f) => f.toFixed(1)).join('/')} Force/1.5 s; `
      + `guard broken → ${B.a.gripShare.toFixed(3)}/${B.b.gripShare.toFixed(3)}, x ${won.x.toFixed(2)} `
      + `(${moved.toFixed(2)} m towards him), wobble ${won.wobble.toFixed(3)}`;
  });

  await check('grip: you can only throw what you own, and breaking his guard is how you come to own it', async () => {
    /**
     * §4.8's second sentence — *"it becomes a projectile with his name on it"* —
     * as a rule rather than a description. Two guarded hands are level at
     * exactly 0.500 by construction, so NEITHER can throw; break his guard and
     * the winner passes a strict majority on the same frame and the throw
     * unlocks. Same key, same crate, opposite answers, and the only thing that
     * changed is something the player did to the man beside him.
     *
     * The refusal is checked for its WORDS as well as its effect, because this
     * suite's own subject is a rule nobody can see: a bare `return` here would
     * read as the throw key being broken, which is precisely the complaint
     * `TOO HEAVY` exists to answer.
     */
    const B = await bench();
    B.hands.push(B.a, B.b); B.take(B.a); B.take(B.b);
    B.drive(1);
    B.w.notices.length = 0;
    B.a.hurlGripped(B.ctx);
    assert(B.a.gripBody === B.crate, 'a level contest let the crate be thrown anyway');
    assert(B.w.notices.length === 1, `a refused throw said ${B.w.notices.length} things, not one`);
    assert(/break his guard/i.test(B.w.notices[0]),
      `the refusal names no way in: ${B.w.notices[0]}`);
    assert(/\d/.test(B.w.notices[0]), `the refusal carries no number: ${B.w.notices[0]}`);

    /* AND NOW THE SAME PRESS, WITH HIS GUARD BROKEN. `_refuse` rate-limits one
     * message per 0.7 s, so the clock is walked past that first — a second
     * refusal that was merely SWALLOWED would otherwise read as a success. */
    B.drive(1.2, { beaten: B.b });
    const before = B.w.notices.length;
    B.a.hurlGripped(B.ctx);
    assert(B.w.notices.length === before, `the throw was refused again: ${B.w.notices.at(-1)}`);
    assert(!B.a.gripBody, 'the winner is still holding the crate he just threw');

    /**
     * AND IT LEAVES EVERY HAND. `_updateGrip` renews the hold every frame, so a
     * loser who was not told would re-take the crate in mid-flight on his very
     * next frame and stop it dead in the air — which is the same
     * last-writer-wins defect the contest exists to end, wearing a throw.
     */
    assert(!B.b.gripBody, 'the loser is still gripping a crate that has been thrown');
    assert(gripHolders(B.crate, B.w.time) === 0, 'the ledger still has hands on a thrown crate');
    assert(B.crate.gravityScale === 1, 'a thrown crate never got its gravity back');
    const flying = B.crate.velocity.length();
    B.drive(0.2);
    assert(B.crate.velocity.length() > flying * 0.5,
      'the crate was caught again by somebody who should have let go');

    B.dispose();
    return `level: refused — "${B.w.notices[0]}"; guard broken: thrown at `
      + `${flying.toFixed(1)} m/s, 0 hands left on it`;
  });

  await check('grip: the bar you are spending is the bar you lose it with', async () => {
    /**
     * THE THIRD LEVER, AND IT IS THE ONE THE BULLET CALLS "both spending pool".
     *
     * `forceResistance` takes the SMALLER of `amount × RESIST_CAP` and
     * `pool × RESIST_PER_FORCE`, so a pool under `pull × RESIST_CAP /
     * RESIST_PER_FORCE` cannot buy the full cancellation any more and the share
     * slides. That means an emptying bar loses a tug-of-war GRADUALLY and
     * visibly rather than at a cliff — and then `_spend` fails and the hold
     * ends through the door it already ended through. Nothing here is a rule
     * added for the contest; it is what running out of the thing you are
     * spending already meant.
     *
     * Force Drain is set to 0 — the setting whose own label reads "unlimited
     * Force" — so the bars stay where they are put and the POOL is the only
     * variable between the rungs. Without it each rung would be measuring its
     * own fifth of a second of drain on top of the pool it was set to, which is
     * two variables and one number.
     */
    const B = await bench();
    B.hands.push(B.a, B.b); B.take(B.a); B.take(B.b);
    const pull = B.a._gripPull(B.crate.mass, false);
    const floor = pull * RESIST_CAP / RESIST_PER_FORCE;
    B.w.settings.forceDrain = 0;
    const rungs = [];
    for (const pool of [B.a.maxForce, floor, floor / 2, floor / 4, floor / 8]) {
      B.a.force = B.a.maxForce; B.b.force = pool;
      B.drive(0.2);
      rungs.push({ pool, share: B.a.gripShare });
    }
    /* AT THE FLOOR EXACTLY, THE TWO ARMS OF THE `min` ARE EQUAL — that is what
     * makes it the floor — so a bar there is the last one that still cancels in
     * full, and anything above it is indistinguishable from a full bar. The
     * slide starts BELOW. Asserting the boundary rather than assuming it is the
     * difference between measuring `forceResistance` and re-typing it. */
    assert(Math.abs(rungs[0].share - SHARE_LEVEL) < 1e-6,
      `a full bar against a full bar is ${rungs[0].share.toFixed(3)}, not level`);
    assert(Math.abs(rungs[1].share - SHARE_LEVEL) < 1e-6,
      `a bar sitting exactly on the saturation floor already loses ground (${rungs[1].share.toFixed(3)}) — `
      + 'the pool arm is biting above where the arithmetic says it starts');
    for (let i = 2; i < rungs.length; i++) {
      assert(rungs[i].share > rungs[i - 1].share + 1e-6,
        `pool ${rungs[i].pool.toFixed(2)} did not lose any more ground than ${rungs[i - 1].pool.toFixed(2)}: `
        + `${rungs[i - 1].share.toFixed(3)} → ${rungs[i].share.toFixed(3)}`);
    }
    /* AND IT GOES FAR ENOUGH TO DECIDE THE THING. A slide that never reaches a
     * majority would leave an empty-handed man able to deadlock a full bar for
     * ever, which is a stalemate rather than a contest. */
    assert(rungs.at(-1).share > 0.5,
      `a nearly empty bar still holds the crate to a draw (${rungs.at(-1).share.toFixed(3)})`);

    B.dispose();
    return `saturation floor ${floor.toFixed(2)} Force against a ${pull.toFixed(2)} hp/s pull; shares `
      + rungs.map((r) => `${r.pool.toFixed(1)}→${r.share.toFixed(3)}`).join(' ');
  });

  await check('grip: the first hand off it is not the crate hitting the floor', async () => {
    /**
     * `releaseGrip` used to end the hold outright — `gravityScale = 1` on a
     * crate, `releaseHold()` on a body. With two people on one object that is
     * the first of them to let go dropping it out of the other's hands, while
     * the other goes on being billed per second for a hold that has already
     * ended. The ending is now conditional on being the LAST hand off it, and
     * both halves of that are asserted, because a version that never ended the
     * hold at all would pass the first.
     */
    const B = await bench();
    B.hands.push(B.a, B.b); B.take(B.a); B.take(B.b);
    B.drive(0.5);
    B.a.releaseGrip();
    B.hands.length = 0; B.hands.push(B.b);
    assert(B.crate.gravityScale === 0, 'one of two hands letting go dropped the crate out of the other');
    assert(gripHolders(B.crate, B.w.time) === 1, 'the ledger did not lose the hand that let go');
    const held = B.drive(0.8, { settle: 1.5 });
    assert(Math.abs(held.x - B.b._wants.x) < 0.8,
      `the surviving hand ended up with the crate at x ${held.x.toFixed(2)} rather than its own ${B.b._wants.x.toFixed(2)}`);
    assert(Math.abs(B.b.gripShare - 1) < 1e-9,
      `the surviving hand still reports a share of ${B.b.gripShare.toFixed(3)} against a contest of one`);
    B.b.releaseGrip();
    assert(B.crate.gravityScale === 1, 'the LAST hand off it did not give the crate its gravity back');
    assert(gripHolders(B.crate, B.w.time) === 0, 'the ledger still holds a claim nobody is making');
    B.dispose();
    return 'first hand off: still held, share 1.000; last hand off: gravity back, ledger empty';
  });


  /* ────────────────────────────────────────────────────────────────────
   * A SQUADMATE GRABS THE MAN YOU ARE GRIPPING — PLAN §4.8, second bullet
   *
   * The first bullet's four checks above are two Players and a crate, because
   * what is under test there is arithmetic. This one cannot be: a grab is a
   * ragdoll suspended off another ragdoll, inside a joint solve, under a
   * reaction the enemy brain has to choose — so every one of these runs on a
   * real World with two real droids and the shipped `world.update`, and the
   * only thing done by hand is taking the grip itself (the pick casts a ray at
   * a crosshair; what is under test is what happens after somebody has hold).
   *
   * `bench` above is not reused for the same reason `coop.mjs` exists: a
   * fixture that could not ragdoll could not fail the way this feature fails.
   * ──────────────────────────────────────────────────────────────────── */

  /**
   * TWO DROIDS ON ONE SIDE, A GRIP ON ONE OF THEM, AND A STEERABLE HOLD POINT.
   *
   * The hold point is steered through the CAMERA's own yaw and pitch rather
   * than by writing `aimDir`, because `Player.update` recomputes `aimDir` from
   * the camera every frame (see `camera.aimDirection`) and a fixture that wrote
   * the aim directly would be measuring a field the shipped path overwrites
   * before it reads it — which is a check that passes against code that does
   * nothing.
   *
   * `hold.z` is the axis everything below drags along, and the two droids stand
   * apart on X: a tow along the line between them cannot tell a man being
   * dragged from a man being run over, and the first version of this fixture
   * reported 0.05 m of tow for exactly that reason.
   */
  async function field({ forcePower = 1, apart = 1.6 } = {}) {
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', quality: 'low', instantSpawn: true, forcePower },
    });
    const input = H.idleInput();
    const step = () => world.update(1 / 60, input);
    for (let i = 0; i < 12; i++) step();
    const p = world.players[0] || world.player;
    const base = p.position.clone();
    const a = world.spawnEnemy('b1', new THREE.Vector3(base.x, 0, base.z - 7));
    const b = world.spawnEnemy('b1', new THREE.Vector3(base.x + apart, 0, base.z - 7));
    for (let i = 0; i < 6; i++) step();
    const hold = new THREE.Vector3(base.x, 1.0, base.z - 7);
    const aim = () => {
      _gv.copy(hold).sub(p.camera.pos);
      const dist = _gv.length();
      _gv.multiplyScalar(1 / Math.max(dist, 1e-6));
      p.camera.pitch = Math.asin(clamp01(_gv.y));
      p.camera.yaw = Math.atan2(-_gv.x, -_gv.z);
      p.camera.syncAim();
      p.gripDistance = dist;
    };
    const take = () => { p.gripEnemy = a; a.hold(); p._liftPoint.copy(a.position); aim(); };
    const drag = (secs, vz = 0) => {
      for (let i = 0; i < Math.round(secs * 60); i++) { hold.z += vz / 60; aim(); step(); }
    };
    /**
     * WHAT THE HOLD WAS BILLED, TAKEN AT `_spend` ITSELF.
     *
     * Not `force` before minus `force` after: the pool REGENERATES while it is
     * being spent, so that difference is the net of two rates and a ratio taken
     * on it is not a ratio of prices. `_spend` is the one door every price in
     * this game goes through (Powers.js's header says so and the whole Force
     * economy depends on it), so wrapping it for a window is the gross bill
     * with nothing else in it. `_holdT` is sampled with it because the wear
     * term rides on that clock and is the control this measurement needs.
     */
    const bill = (secs) => {
      const t0 = p._holdT || 0;
      let sum = 0;
      const real = Player.prototype._spend;
      p._spend = function (amount, partial) {
        const ok = real.call(this, amount, partial);
        if (ok) sum += amount;
        return ok;
      };
      drag(secs);
      delete p._spend;
      return { rate: sum / secs, wear: 1 + 0.75 * Math.min(1, ((t0 + (p._holdT || 0)) / 2) / 6) };
    };
    return { world, p, a, b, hold, take, drag, bill, step, base,
      done: () => world.unload() };
  }

  await check('grip: a squadmate takes hold of the man you are lifting, and you are then lifting two', async () => {
    /**
     * ── THE BULLET'S FIRST HALF, AND IT IS A BILL ───────────────────────
     *
     * *"Grip one, drag two, the contest resolving against combined mass."*
     *
     * `Enemy.heldMass` is the whole of "combined" — the man plus whatever is
     * hanging off him — and the claim being tested is that it reaches the
     * player through the numbers that were already there rather than through a
     * rule written for grabs. So what is measured is the SHIPPED BILL: the
     * Force `_updateGrip` actually took out of the pool, per second, with a man
     * on him and without.
     *
     * THE SECOND WINDOW IS THE LIGHTER ONE, AND THAT IS THE POINT. A hold gets
     * more expensive the longer it runs — `wear` climbs from 1.00 to 1.75 over
     * six seconds and never resets inside a hold — so the later window is
     * strictly disadvantaged. If the grabbed window still costs more, the extra
     * cannot be time: it is the second man. A ratio measured the other way
     * round would have had wear on its side and proved nothing.
     */
    const F = await field();
    F.take();
    /* HE IS ALREADY WITHIN ARM'S REACH, so the grab is immediate — the run-in
     * has a check of its own below. */
    F.drag(0.5);
    const held = F.bill(0.7);
    const mass = heldMass(F.a);
    assert(F.a.grabbedBy === F.b, 'nobody took hold of a man being lifted off the ground');
    assert(mass === (F.a.A.mass + F.b.A.mass),
      `the Force is lifting ${mass} kg against the ${F.a.A.mass}+${F.b.A.mass} two droids weigh`);
    /* AND HE IS OUT OF THE FIGHT FOR IT. A grab that cost the man nothing would
     * be free for the line and the player would have no reason to prefer any
     * other target — this is the same price `stepDrag` charges a man who goes
     * back for a casualty, taken through the same `gripped`/`liftTarget` pair
     * every held body in the game already uses. */
    assert(F.b.gripped && !!F.b.liftTarget && F.b.actor?.ragdolled,
      'the man doing the grabbing never left his feet');
    assert(F.b.reaction?.kind === 'grab', 'his brain is still running a formation');

    /**
     * NOW SHOOT HIM OFF, and it is a bullet rather than a yank because the yank
     * would move the hold point — `far` is a term in the same bill and a
     * control that changed the geometry as well as the load would be measuring
     * two things. The break force has its own check below.
     *
     * The 0.7 s that follows is longer than `DRAG_LEASE` on purpose: a grabber
     * who is killed does not tidy up after himself, his CLAIM LAPSES, and the
     * load stays on the Force until it does. That is the same lease
     * `beingDragged` runs on and it is asserted here rather than assumed.
     */
    F.b.damage(F.b.maxHp * 3, F.b.position, null, 'check');
    F.drag(0.7);
    assert(!F.a.grabbedBy && F.a.grabLoad === 0 && heldMass(F.a) === F.a.A.mass,
      'the load stayed on the Force after the man carrying it was killed');
    const alone = F.bill(0.7);

    /**
     * ── THE ONE THING BETWEEN THE TWO WINDOWS THAT IS NOT THE SECOND MAN ──
     *
     * `wear` climbs from 1.00 to 1.75 over six seconds inside a hold and never
     * resets, and the two windows are 1.4 s apart — which is worth almost
     * exactly what the second droid is worth. Measured with the raw rates:
     * 17.46 Force/s grabbed against 17.50 alone, and the whole of that dead
     * heat was wear cancelling the mass. A "it costs more" written on the raw
     * numbers would have been a coin toss dressed as a measurement.
     *
     * So the wear term is DIVIDED BACK OUT, using the shipped law rather than a
     * fitted one, and what is left of each window is `_holdRate × far ÷ √P`
     * with `far` and `P` identical between them by construction — the geometry
     * is untouched and the mate was shot rather than yanked off precisely so it
     * would be. The remaining ratio can only be the mass, and the assertion
     * says which mass: `_holdRate(104)/_holdRate(52)`, off the two archetype
     * masses and the cap, with no number typed here.
     */
    const massRatio = F.p._holdRate(mass, true) / F.p._holdRate(F.a.A.mass, true);
    const heldNorm = held.rate / held.wear, aloneNorm = alone.rate / alone.wear;
    assert(heldNorm > aloneNorm,
      `a hold with two men on it cost ${heldNorm.toFixed(2)} Force/s against ${aloneNorm.toFixed(2)} for one`);
    assert(Math.abs(heldNorm / aloneNorm - massRatio) < 0.03,
      `the bill went up by \u00d7${(heldNorm / aloneNorm).toFixed(3)} against the \u00d7${massRatio.toFixed(3)} `
      + '`_holdRate` says the second droid is worth');

    F.done();
    return `heldMass ${mass} kg (${F.a.A.mass}+${F.b.A.mass}); ${heldNorm.toFixed(2)} Force/s with him on against `
      + `${aloneNorm.toFixed(2)} without, wear divided out — \u00d7${(heldNorm / aloneNorm).toFixed(3)} `
      + `against _holdRate's \u00d7${massRatio.toFixed(3)}`;
  });

  await check('grip: one break force — drag the pair slowly and you drag two men, drag them fast and the grab is torn off', async () => {
    /**
     * ── THE BULLET'S OTHER HALF ─────────────────────────────────────────
     *
     * *"One joint, one break force."* `GRAB_BREAK` is `DRAG.haul × DRAG.reach`
     * — `Ragdoll.suspend` drives a chest at `(target − chest) × strength`, so a
     * pair of arms anchored a reach away can never command more than that, and
     * a link driven toward a point receding at `v` settles at an over-stretch
     * of `v / DRAG.haul`. Both rungs below are stated as fractions of it and
     * neither is a speed chosen to pass.
     *
     * THE TOW IS THE HALF THAT IS EASY TO LOSE. A grab that never moved the
     * grabber would be a mass penalty with a man standing next to it, so the
     * slow rung asserts he COVERED GROUND — this is the "drag two" in the
     * bullet, and it is the thing a player sees.
     */
    const F = await field();
    F.take();
    F.drag(0.8);
    assert(F.a.grabbedBy === F.b, 'setup: nobody grabbed him');
    const z0 = F.b.position.z, za = F.a.position.z;
    F.drag(1.5, -GRAB_BREAK * 0.45);
    const towed = Math.abs(F.b.position.z - z0), led = Math.abs(F.a.position.z - za);
    assert(F.a.grabbedBy === F.b,
      `a tow at ${(GRAB_BREAK * 0.45).toFixed(2)} m/s tore a joint rated at ${GRAB_BREAK.toFixed(2)}`);
    assert(towed > 0.5,
      `the man you are gripping travelled ${led.toFixed(2)} m and the man holding him travelled ${towed.toFixed(2)} — `
      + 'he is a weight, not a second body being dragged');

    /* AND OVER THE RATING IT LETS GO. Same joint, same pair, same second — the
     * only thing that changed is how hard the far end is being pulled. */
    F.drag(1.0, -GRAB_BREAK * 2.2);
    assert(!F.a.grabbedBy && F.b.grabWhy === 'torn',
      `dragging at ${(GRAB_BREAK * 2.2).toFixed(2)} m/s did not break a joint rated at ${GRAB_BREAK.toFixed(2)} `
      + `(it ended as "${F.b.grabWhy}")`);
    /* THE GRIP SURVIVES THE BREAK, which is what makes this a decision rather
     * than a way of losing your hold: you yank his mate off him and you still
     * have him. */
    assert(F.p.gripEnemy === F.a && F.a.gripped,
      'tearing the second man off dropped the first one too');
    assert(F.a.grabLoad === 0 && !F.b.gripped,
      'the man who let go is still hanging off him');
    F.done();
    return `rated ${GRAB_BREAK.toFixed(2)} m/s; at ${(GRAB_BREAK * 0.45).toFixed(2)} he held on and was towed `
      + `${towed.toFixed(2)} m behind a ${led.toFixed(2)} m drag; at ${(GRAB_BREAK * 2.2).toFixed(2)} he was torn off`;
  });

  await check('grip: a pair heavier than your cap is pulled out of your hands, and it says so', async () => {
    /**
     * THE DECISION THE COMBINED MASS IS FOR, and it is the same `m > cap` gate
     * a lift has always been refused by — reached now by the LOAD changing
     * under a hold rather than by the slider changing under one.
     *
     * Force Power 0.5 puts the cap at 78 kg, between one droid (52) and two
     * (104), which is the whole of the fixture: nothing here is tuned, the two
     * masses are the archetype's and the cap is `LIFT_AT_ONE × P^1.5`.
     *
     * AND IT IS NOT A SILENT DROP. A body leaving your hands the instant
     * somebody grabs it, with nothing on screen, reads as the grip breaking —
     * which is exactly the complaint `TOO HEAVY` was written to answer, so it
     * is the same sentence, through the same `_liftRefusal`, carrying the same
     * two numbers.
     */
    /* `apart: 14` is BEYOND `DRAG.look`, so the control window is a man who has
     * not even noticed rather than a man on his way — a claim is made the frame
     * he notices and the load only lands when he arrives, and a control that
     * confused the two would be measuring the run-in. */
    const F = await field({ forcePower: 0.5, apart: 14 });
    const cap = F.p.liftCapacity;
    assert(F.a.A.mass < cap && F.a.A.mass + F.b.A.mass > cap,
      `the fixture is not on the boundary: ${F.a.A.mass}/${F.a.A.mass + F.b.A.mass} kg against a ${cap.toFixed(1)} kg cap`);
    const said = [];
    F.world.notify = (t, d) => said.push(`${t} — ${d}`);
    F.take();
    F.drag(1.0);
    assert(F.p.gripEnemy === F.a && F.a.grabLoad === 0,
      'the control failed: one droid at half Force Power is already too heavy, or somebody reached him');
    /* HIS MATE ARRIVES. Placed rather than walked, because what is under test
     * is the gate and not the pathing — the run-in is the height check below. */
    F.b.position.set(F.a.position.x + 1.2, 0, F.a.position.z);
    F.drag(0.5);
    assert(!F.p.gripEnemy, 'the two of them together were still liftable at half the cap');
    assert(F.p.lastGripRefusal && Math.round(F.p.lastGripRefusal.mass) === F.a.A.mass + F.b.A.mass,
      `the refusal recorded ${F.p.lastGripRefusal?.mass} kg, not the pair's ${F.a.A.mass + F.b.A.mass}`);
    assert(said.length === 1 && /TOO HEAVY/.test(said[0]),
      `losing the pair said ${said.length} things: ${said.join(' | ')}`);
    assert(/\d+ kg/.test(said[0]) && /Force Power/i.test(said[0]),
      `the message carries no mass and no lever: ${said[0]}`);
    F.done();
    return `cap ${cap.toFixed(1)} kg: one droid (${F.a.A.mass}) held, the pair (${F.a.A.mass + F.b.A.mass}) refused — "${said[0]}"`;
  });

  await check('grip: lift him over their heads and nobody can get hold of him', async () => {
    /**
     * THE FREE COUNTER-PLAY, and the reason the grab is a decision on the
     * player's side too. A man can only take hold of what he can reach:
     * `reachForHelp` refuses a body more than `DRAG.reach` above his own feet,
     * and `stepGrab` re-reads that while he is still running in, so a body
     * lifted away from him mid-approach is a body he never gets to.
     *
     * Same scene, same two droids, same key — the only thing that differs
     * between the two halves is where the player is pointing. That is what
     * makes it counter-play rather than a range limit.
     *
     * `apart: 6` so he has to RUN, which is also the only place `stepGrab`'s
     * approach branch is exercised.
     */
    const F = await field({ apart: 6 });
    F.hold.y = 2.8;
    F.take();
    F.drag(1.6);
    assert(F.a.position.y > 2, `setup: the body only reached y ${F.a.position.y.toFixed(2)}`);
    assert(!F.a.grabbedBy && F.b.grabWhy === 'high',
      `a droid held ${F.a.position.y.toFixed(2)} m up was grabbed anyway (${F.b.grabWhy})`);
    assert(!F.b.reaction, 'he is still running at a body he cannot reach');
    /* AND THE SAME MAN, THE SAME SECOND, WITH THE BODY BROUGHT DOWN. */
    F.hold.y = 1.0;
    F.drag(1.6);
    assert(F.a.gripped, 'the control failed: the hold ended before the second half');
    assert(F.a.grabbedBy === F.b,
      `brought back down to y ${F.a.position.y.toFixed(2)} he still went ungrabbed`);
    F.done();
    return 'held at 2.8 m: refused as out of reach; brought down to 1.0 m: grabbed by the same man';
  });

  await check('grip: a throw takes the man and leaves the one holding him', async () => {
    /**
     * THE COMPOSITION, and it is written here because it is the one place a
     * grab could have needed a line inside `hurlGripped` and does not.
     *
     * A grab is a grab on a man THE FORCE HAS HOLD OF: `stepGrab` ends the
     * moment `gripped` goes false, and `_hurlBody` clears it on the frame it
     * throws. So the throw needs no clause about grabs, the mate is not thrown
     * with him, and the load comes off the Force at the same instant the man
     * does. The one thing the grab DOES reach is the throw's speed law, which
     * reads `heldMass` — two men leave slower than one, out of `lerp(1.2, 0.5,
     * m/cap)` and not out of anything written for this.
     */
    const F = await field();
    F.take();
    F.drag(0.8);
    assert(F.a.grabbedBy === F.b, 'setup: nobody grabbed him');
    const az = F.a.position.clone(), bz = F.b.position.clone();
    const ctx = F.world._frameCtx;
    F.p.hurlGripped(ctx);
    /* `_hurlBody`'s own `stun(0.9, dir, 1.3)` is the signature of a throw having
     * landed on this body, and it is read here rather than the distance he
     * covered: `_aimTarget` answers the nearest body in the aim cone, which
     * with the crosshair on the man you are holding is HIM — so the shipped
     * throw sends a gripped droid up his own axis rather than downrange. That
     * is a real quirk of the aim pick, it is not this bullet's, and what
     * matters here is which of the two men the throw took. */
    const threw = F.a.stunTimer;
    assert(!F.p.gripEnemy && !F.a.gripped, 'the throw did not let go of him');
    F.drag(0.5);
    assert(!F.a.grabbedBy && F.a.grabLoad === 0 && F.b.grabWhy === 'free',
      `the grab outlived the grip it was a grab on (${F.b.grabWhy})`);
    assert(!F.b.gripped, 'the man who was holding him is still being held by nothing');
    const flew = F.a.position.distanceTo(az), stayed = F.b.position.distanceTo(bz);
    assert(threw > 0, 'the thrown man was never stunned in the direction he went — no throw landed on him');
    assert(flew > stayed * 2,
      `the throw moved the man ${flew.toFixed(2)} m and the man holding him ${stayed.toFixed(2)} m`);
    F.done();
    return `thrown (stun ${threw.toFixed(2)} s, ${flew.toFixed(2)} m) while the man who had hold of him moved `
      + `${stayed.toFixed(2)} m and was let go as "free"`;
  });

}
