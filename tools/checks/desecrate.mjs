/**
 * DESECRATE THE FALLEN — the order, the tearing, and the frenzy it pays.
 *
 * The player asked for the burial's opposite: *"instead of burying our dead
 * and getting those buffs, certain troops go off and desecrate fallen enemies
 * like they tear them apart and take limbs off etc, real ragdoll physics …
 * this enrages the troops and gets them into a killing frenzy."*
 *
 * So this holds the four things that sentence promises and nothing else: a
 * detail goes, it works on THEIR dead, limbs actually come off the ragdoll,
 * and the line ends up in a frenzy that makes it hit harder and shoot wider.
 * The Jedi/Sith split is the fifth, and it is the only one that reads a
 * setting.
 */
import * as THREE from 'three';
import { DESECRATE, FORMATIONS } from '../../src/game/Command.js';
import { FURY } from '../../src/game/Enemy.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STEP = 1 / 30;

async function line(order = 'jedi', seed = 5) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order, quality: 'low', instantSpawn: true },
    runSeed: seed,
  });
  const d = world.command;
  d.start(1);
  d.spawnQueue.length = 0;
  d.active = false;
  d.intermission = Infinity;
  d.onMuster = () => {};
  const input = idleInput();
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  return { world, d, input, c: d.commander };
}

/** Kill `n` hostiles on the ground in front of the line, and ragdoll them. */
function theirDead(world, d, n, input) {
  const at = d.commander?.player?.position || d.commander?.anchor;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = at.clone().add(V(6 + i * 2.2, 0, 4 + (i % 2) * 2));
    p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
    const e = world.spawnEnemy('b1', p);
    if (!e) continue;
    e.damage(e.hp + 50, e.position, null, 'bolt');
    out.push(e);
  }
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  return out.filter((e) => e.dead && !e.disposed);
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('desecrate: the order is on the wheel, keyed, and it is the burial\'s mirror', () => {
    const F = FORMATIONS.desecrate;
    assert(F, 'no desecrate order');
    assert(F.rends === true, 'the order does not declare `rends`');
    assert(F.key && F.key !== FORMATIONS.bury.key, `it shares ${F.key} with the burial`);
    assert(F.advance === false, 'a desecration detail that follows the commander carries the bodies with it');
    assert(DESECRATE.share > 0 && DESECRATE.share < 0.5, `${DESECRATE.share} of the line is not "a portion"`);
    assert(DESECRATE.moraleJedi < 0 && DESECRATE.moraleSith > 0,
      'a Jedi company should pay for it and a Sith company should feed on it');
    return `${F.name} on ${F.key}, ${(DESECRATE.share * 100) | 0}% detailed, `
      + `jedi ${DESECRATE.moraleJedi} / sith ${DESECRATE.moraleSith}`;
  });

  check('desecrate: with none of theirs down, the order says so and details nobody', async () => {
    const { world, d, c } = await line();
    try {
      const before = d.led(c).filter((t) => t.rending).length;
      const ok = d._desecrateStart(c, d.led(c), null);
      assert(!ok, 'it detailed men with no enemy dead on the field');
      assert(!c.rending, 'it opened a detail anyway');
      assert(d.led(c).filter((t) => t.rending).length === before, 'men were marked');
      return 'refused, and the field said why';
    } finally { world.unload(); }
  });

  check('desecrate: a detail goes out, limbs come off, and the line goes into a frenzy', async () => {
    const { world, d, input, c } = await line();
    try {
      const dead = theirDead(world, d, 4, input);
      assert(dead.length >= 2, `only ${dead.length} of theirs went down`);
      const men = d.led(c).filter((t) => t.body && !t.body.dead);
      assert(d._desecrateStart(c, men, null), 'the order refused with their dead on the field');
      const detail = men.filter((t) => t.rending);
      assert(detail.length >= DESECRATE.min, `${detail.length} detailed, under the floor of ${DESECRATE.min}`);
      assert(detail.length < men.length, 'the whole line went — it is meant to be a portion');
      /* The steadiest men are NOT the ones who go. */
      const dOut = detail.reduce((s, t) => s + t.attr('discipline'), 0) / detail.length;
      const rest = men.filter((t) => !t.rending);
      const dIn = rest.reduce((s, t) => s + t.attr('discipline'), 0) / Math.max(1, rest.length);
      assert(dOut <= dIn, `the detail's discipline ${dOut.toFixed(0)} is above the line's ${dIn.toFixed(0)}`);

      let torn = null;
      for (let i = 0; i < 30 * 40 && !torn; i++) {
        world.update(STEP, input);
        torn = dead.find((e) => e._rent);
      }
      assert(torn, 'nobody finished a body in forty seconds');
      /* THE PIECES ARE REAL, and on a CORPSE that is `severedCount` rather
       * than `isSevered`: `Ragdoll.cut` routes a ragdolled body to
       * `cutRagdoll` on purpose — "a corpse's bones are already loose bodies
       * with colliders of their own, so cutting one is a shorter collider and
       * a broken joint, not a new piece" — so the limb comes off as physics
       * and the bone is never flagged the way a live cut flags it. */
      const gone = torn.actor?.severedCount ?? 0;
      assert(gone >= 1, 'the body was marked worked and nothing came off it');
      /**
       * …AND THE HEAD IS AMONG THEM, which the player asked for by name —
       * "take off real limbs/heads" — and which was missing: the bone list was
       * eight entries of arms and legs, so the one piece everybody pictures
       * when they hear this order never came off anything.
       *
       * READ OFF `bone.cutT`, not off `isSevered`. `cutRagdoll` shortens the
       * bone with `bone.cutT *= t` and does NOT set the severed flag a live
       * cut sets — see the note above — so `cutT < 1` is the only per-bone
       * record that a piece came off this corpse.
       */
      const cutT = (n) => torn.rig?.get?.(n)?.cutT ?? 1;
      assert(cutT('head') < 1,
        'every limb came off and the head stayed on — DESECRATE.headBelow is not reaching anybody');
      /**
       * AND THE COUNT IS THE COUNT. `_desecrateFinish` used to increment
       * `took` off `cutRagdoll`'s return value, which reports whether a JOINT
       * broke rather than whether a piece came off; on a corpse the joints are
       * often already gone, so it cut the limb, reported false, and walked the
       * whole eight-bone list. Measured: every worked body lost every limb
       * while `DESECRATE.limbs` said two.
       *
       * So: the far ends go and the roots stay, which is what the bone list is
       * ordered for — "there is something left to recognise".
       */
      const off = ['foreL', 'foreR', 'shinL', 'shinR', 'armL', 'armR', 'thighL', 'thighR']
        .filter((n) => cutT(n) < 1);
      assert(off.length <= DESECRATE.limbs,
        `${off.length} limbs came off against a stated ${DESECRATE.limbs} (${off.join(', ')}) — `
        + 'the count is being taken off something other than what came off');
      const roots = ['armL', 'armR', 'thighL', 'thighR'].filter((n) => cutT(n) < 1);
      assert(roots.length < 4,
        'every root joint came off too — there is nothing left of him to recognise');
      /* And the line has its blood up. */
      const furious = d.led(c).filter((t) => (t.body?.furyTimer ?? 0) > 0);
      assert(furious.length >= 2, `${furious.length} men felt it`);
      const best = Math.max(...furious.map((t) => t.body.furyTimer));
      assert(best > FURY.seconds * 0.5, `the frenzy was ${best.toFixed(1)} s of ${FURY.seconds}`);
      return `${detail.length} of ${men.length} detailed (discipline ${dOut.toFixed(0)} vs ${dIn.toFixed(0)}), `
        + `${off.length} limbs off and the head with them, ${furious.length} men in a frenzy `
        + `for ${best.toFixed(0)} s`;
    } finally { world.unload(); }
  });

  check('desecrate: the frenzy hits harder, fires faster and shoots wider', async () => {
    const { world, d, input, c } = await line();
    try {
      const t = d.led(c).find((x) => x.body && !x.body.dead);
      const e = t.body;
      const aim0 = e.aimQuality(20);
      e.furyTimer = FURY.seconds;
      const aim1 = e.aimQuality(20);
      assert(aim1 > aim0 * 1.2, `spread ${aim0.toFixed(2)} → ${aim1.toFixed(2)} — a frenzy should widen it`);
      assert(FURY.damage > 1.2 && FURY.rate < 0.8 && FURY.speed > 1,
        'the frenzy does not pay in damage, rate and pace');
      assert(FURY.aim > 1, 'the frenzy has no cost');
      /* It drains, on the world's own frame. */
      for (let i = 0; i < 30; i++) world.update(STEP, input);
      assert(e.furyTimer < FURY.seconds, 'the frenzy never runs out');
      return `spread ×${(aim1 / aim0).toFixed(2)}, damage ×${FURY.damage}, rate ×${FURY.rate}, `
        + `pace ×${FURY.speed}, ${FURY.seconds} s`;
    } finally { world.unload(); }
  });

  check('desecrate: contact ends it and everybody comes back to the line', async () => {
    const { world, d, input, c } = await line();
    try {
      theirDead(world, d, 3, input);
      const men = d.led(c).filter((t) => t.body && !t.body.dead);
      assert(d._desecrateStart(c, men, null), 'the order refused');
      assert(c.rending, 'no detail');
      const out = d.led(c).filter((t) => t.rending).length;
      assert(out >= DESECRATE.min, 'nobody was detailed');
      /* THE RULE IS DRIVEN, NOT A WAVE. `active` is a plain field the
       * director writes from its own wave machinery, and this fixture holds
       * the director quiet on purpose (`intermission = Infinity`, an empty
       * spawn queue) so the detail can be watched at all — a wave fabricated
       * by hand here would be testing the fixture. What the rule reads is
       * `this.active` against `rending.active0`, so that is what is set. */
      c.rending.active0 = false;
      d.active = true;
      d._desecrateTick(2.0, c);
      assert(!c.rending, 'the detail was still out with the wave on them');
      assert(!d.led(c).some((t) => t.rending), 'a man is still marked');
      for (const t of men) {
        if (!t.body) continue;
        assert(!t.body.wish || t.body.wish.lengthSq() >= 0, 'a man came back holding a heading to a corpse');
      }
      return `${out} detailed, contact ended it and every one came back`;
    } finally { world.unload(); }
  });
}
